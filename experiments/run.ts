/**
 * Host-side experiment runner. Replaces the former control-api + flags-service:
 * fault-tolerance mechanisms toggle together via FT_MODE env on each deployment,
 * faults are injected with kubectl/docker and the services' /chaos endpoints.
 *
 * Usage:
 *   pnpm --filter @ftr/experiments exp matrix            # all scenarios, baseline + ft
 *   pnpm --filter @ftr/experiments exp <scenario> <baseline|ft|both>
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import axios from "axios";
import { Client } from "pg";
import { seed } from "../scripts/db/seed";
import { HealthPoint, ReqRecord, ScenarioName, summarize } from "./analysis";

const pexec = promisify(execFile);
const ROOT = join(__dirname, "..");
const RESULTS_DIR = join(__dirname, "results");
const DB_URL = process.env.DATABASE_URL_HOST ?? "postgres://ftr:ftr@127.0.0.1:30432/university";
const TOKEN = process.env.CHAOS_TOKEN ?? "dev-chaos-token";
const GATEWAY = process.env.GATEWAY_URL ?? "http://127.0.0.1:30080";

const APP_PORT: Record<string, number> = { gateway: 30080, "student-service": 30001, "payment-service": 30002, "records-service": 30003, "timetable-service": 30004 };
const APPS = Object.keys(APP_PORT);
const WORKERS = ["ftr-worker", "ftr-worker2", "ftr-worker3"];
const PG = "postgres-primary";

const WARMUP_MS = 30_000, OBSERVE_MS = 90_000, FAILOVER_AT_MS = 5_000, HEALTH_EVERY_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const exec = async (cmd: string, args: string[]) => (await pexec(cmd, args, { cwd: ROOT })).stdout;
const k = (...a: string[]) => exec("kubectl", ["-n", "university", ...a]);
const chaos = (app: string, path: string, body: object = {}) =>
  axios.post(`http://127.0.0.1:${APP_PORT[app]}${path}`, body, { headers: { "x-chaos-token": TOKEN }, timeout: 5000 });

// ---------------------------------------------------------------- infra ops

const infra = {
  async setFtMode(on: boolean) {
    await k("set", "env", ...APPS.map((a) => `deploy/${a}`), `FT_MODE=${on ? "on" : "off"}`);
  },
  async scaleAll(replicas: number) {
    await Promise.all(APPS.map((a) => k("scale", `deploy/${a}`, `--replicas=${replicas}`)));
  },
  async rolloutAll() {
    await Promise.all(APPS.map((a) => k("rollout", "status", `deploy/${a}`, "--timeout=120s")));
    // rollout status returns while superseded pods are still Terminating; those pods ignore SIGTERM
    // and keep serving keep-alive connections with the OLD FT_MODE until killed, so wait them out
    for (let i = 0; i < 30; i++) {
      const out = await k("get", "pods", "-o", "jsonpath={range .items[?(@.metadata.deletionTimestamp)]}{.metadata.name} {end}");
      if (!out.trim()) return;
      await sleep(2000);
    }
    throw new Error("pods still terminating after 60s");
  },
  async crashInstance(app: string) {
    try { await chaos(app, "/chaos/crash"); }
    catch (e: any) { // process exits mid-request: connection drop == success
      if (!/ECONNRESET|socket hang up|EPIPE/i.test(`${e?.code ?? ""} ${e?.message ?? ""}`)) throw e;
    }
  },
  setLatency: (app: string, ms: number) => chaos(app, "/chaos/latency", { ms }),
  failMidwayOn: () => chaos("payment-service", "/chaos/fail-midway"),
  async chaosResetAll() {
    await Promise.allSettled(APPS.map((a) => chaos(a, "/chaos/reset")));
  },
  async listNodes() {
    const out = await exec("docker", ["ps", "-a", "--filter", "name=ftr-", "--format", "{{json .}}"]);
    return out.split("\n").filter(Boolean).map((l) => {
      const j = JSON.parse(l);
      return { name: j.Names as string, running: j.State === "running" };
    }).filter((n) => /^ftr-(control-plane|worker\d*)$/.test(n.name));
  },
  async ensureNodesUp() {
    for (const n of await this.listNodes()) if (!n.running) await exec("docker", ["start", n.name]);
  },
  /** stop a worker that hosts no postgres pod (postgres placement varies), remember it for restart */
  async stopNode(): Promise<string> {
    const used = (await k("get", "pods", "-l", "app=postgres", "-o", "jsonpath={.items[*].spec.nodeName}")).trim().split(/\s+/);
    const up = new Set((await this.listNodes()).filter((n) => n.running).map((n) => n.name));
    const name = WORKERS.find((w) => !used.includes(w) && up.has(w));
    if (!name) throw new Error("no running DB-free worker available");
    await exec("docker", ["stop", name]);
    return name;
  },
  startNode: (name: string) => exec("docker", ["start", name]),
  async setProbes(enabled: boolean) {
    if (enabled) {
      return void (await exec("kubectl", ["apply", ...APPS.flatMap((a) => ["-f", `k8s/university/${a}.yaml`])]));
    }
    const absent = /does not exist|not found|unable to find|rejected our request due to an error in our request/i;
    // one patch per probe so an already-absent one doesn't block removing the other
    await Promise.all(APPS.flatMap((a) => ["livenessProbe", "readinessProbe"].map((p) =>
      k("patch", `deploy/${a}`, "--type=json", "-p", JSON.stringify([{ op: "remove", path: `/spec/template/spec/containers/0/${p}` }]))
        .catch((e: any) => { if (!absent.test(`${e?.stderr ?? ""} ${e?.message ?? ""}`)) throw e; }))));
    for (const a of APPS) { // verify: tolerated errors must not hide a probe that is still attached
      const left = (await k("get", "deploy", a, "-o", "jsonpath={.spec.template.spec.containers[0].livenessProbe}")).trim();
      if (left) throw new Error(`livenessProbe still present on ${a}`);
    }
  },
  async killDbPrimary() {
    await k("scale", `statefulset/${PG}`, "--replicas=0");
    await k("delete", "pod", `${PG}-0`, "--grace-period=0", "--force", "--ignore-not-found");
  },
  async failoverDb() {
    await k("scale", `statefulset/${PG}`, "--replicas=0"); // defensive, idempotent
    const r = await k("exec", "postgres-replica-0", "--", "psql", "-U", "ftr", "-d", "university", "-tAc", "SELECT pg_is_in_recovery()");
    if (r.trim() === "t") {
      await k("exec", "postgres-replica-0", "--", "su", "postgres", "-c", "pg_ctl promote -D /var/lib/postgresql/data/pgdata");
    }
    await k("label", "pod", "postgres-replica-0", "db-active=true", "--overwrite");
  },
  async healDb() {
    await exec("bash", ["scripts/db-heal.sh"]);
    await k("scale", `statefulset/${PG}`, "--replicas=1");
  },
};

async function probe(app: string): Promise<boolean> {
  try { return (await axios.get(`http://127.0.0.1:${APP_PORT[app]}/health`, { timeout: 2000, validateStatus: () => true })).status < 400; }
  catch { return false; }
}

// ---------------------------------------------------------------- db checks

// tuition_status holds one row per student (payment_id = latest), so match by student, not payment_id; null-key
// heuristic is per-second since the load gen draws students from a small pool (per-day grouping = pure noise).
const DUP_SQL = `SELECT
 (SELECT count(*) FROM (SELECT 1 FROM payment.payments WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING count(*)>1) d)
 + COALESCE((SELECT sum(c-1) FROM (SELECT count(*) c FROM payment.payments WHERE idempotency_key IS NULL
     GROUP BY student_id, amount, date_trunc('second', created_at) HAVING count(*)>1) n), 0) AS n`;
const BAD_SQL = `SELECT count(*) AS n FROM payment.payments p WHERE p.status IN ('debited','recorded')
 OR (p.status='completed' AND NOT EXISTS (SELECT 1 FROM records.tuition_status t WHERE t.student_id = p.student_id AND t.paid))`;

async function consistency() {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    return {
      duplicates: Number((await c.query(DUP_SQL)).rows[0].n),
      inconsistent: Number((await c.query(BAD_SQL)).rows[0].n),
    };
  } finally { await c.end(); }
}

/** Poll inconsistency every 5s until two consecutive equal readings (after 45s elapsed or reading is 0), max ~60s. */
async function settled() {
  let prev: { duplicates: number; inconsistent: number } | undefined;
  const start = Date.now();
  for (let i = 0; ; i++) {
    const cur = await consistency();
    const elapsed = Date.now() - start;
    const canAcceptStability = elapsed >= 45_000 || cur.inconsistent === 0;
    if ((prev && prev.inconsistent === cur.inconsistent && canAcceptStability) || i >= 12) return cur;
    prev = cur;
    await sleep(5_000);
  }
}

// ---------------------------------------------------------------- reset

const TABLES = ["student.students", "student.enrollments", "payment.payments", "payment.payment_steps",
  "records.grades", "records.tuition_status", "timetable.timetables"];

async function needsHeal(): Promise<boolean> {
  const kq = async (args: string[]): Promise<string | null> => {
    try { return (await k(...args)).trim(); }
    catch (e: any) {
      if (/NotFound|not found/i.test(`${e?.stderr ?? ""} ${e?.message ?? ""}`)) return null;
      throw new Error("cluster unreachable");
    }
  };
  const replicas = await kq(["get", "statefulset", PG, "-o", "jsonpath={.spec.replicas}"]);
  if (!replicas || replicas === "0") return true;
  return !(await kq(["get", "pod", `${PG}-0`, "-o", "name"]));
}

async function reset() {
  await infra.ensureNodesUp(); // a stopped node would break heal/seed
  if (await needsHeal()) {
    await exec("bash", ["scripts/db-heal.sh"]); // re-seeds itself
  } else {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    try { await c.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`); } finally { await c.end(); }
    await seed(DB_URL);
  }
  await Promise.allSettled(APPS.flatMap((a) => [chaos(a, "/admin/cache-reset"), chaos(a, "/chaos/reset")]));
}

// ---------------------------------------------------------------- load generator

interface Req { method: "GET" | "POST"; url: string; body?: object; headers?: Record<string, string> }
const int = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
let counter = 0;

const requests: Record<ScenarioName, () => Req> = {
  register: () => {
    const n = ++counter;
    return { method: "POST", url: `${GATEWAY}/api/students`, body: { name: `Load ${n}`, email: `load-${Date.now()}-${n}@example.com` } };
  },
  enroll: () => ({ method: "POST", url: `${GATEWAY}/api/enrollments`, body: { studentId: int(1, 100), courseId: int(1, 10) } }),
  pay: () => ({ method: "POST", url: `${GATEWAY}/api/payments`, body: { studentId: int(1, 100), amount: 100 }, headers: { "Idempotency-Key": randomUUID() } }),
  transcript: () => ({ method: "GET", url: `${GATEWAY}/api/transcripts/${int(1, 50)}` }),
  timetable: () => ({ method: "GET", url: `${GATEWAY}/api/timetables/${int(1, 10)}` }),
};

const MIX: Record<ScenarioName, number> = { register: 1, enroll: 2, pay: 2, transcript: 3, timetable: 2 };
const OK: Record<ScenarioName, number[]> = { register: [201], enroll: [201, 409], pay: [200, 201], transcript: [200, 202], timetable: [200] };

function judge(sc: ScenarioName, status: number, headers: Record<string, unknown> = {}) {
  const ok = OK[sc].includes(status);
  const degraded = ok && ((sc === "transcript" && status === 202) || (sc === "timetable" && headers["x-degraded"] != null));
  return { ok, degraded: degraded || undefined };
}

function pick(): ScenarioName {
  const entries = Object.entries(MIX) as [ScenarioName, number][];
  let x = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [n, w] of entries) if ((x -= w) < 0) return n;
  return entries[0][0];
}

class Loadgen {
  private timer?: NodeJS.Timeout;
  private startedAt = 0;
  private records: ReqRecord[] = [];
  private acc = 0;

  start(rps: number) {
    this.startedAt = Date.now(); this.records = []; this.acc = 0;
    this.timer = setInterval(() => {
      this.acc += rps / 10;
      while (this.acc >= 1) { this.acc -= 1; void this.fire(); }
    }, 100);
  }

  /** stop() is synchronous; in-flight requests that finish later are dropped. */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const log = { startedAt: this.startedAt, stoppedAt: Date.now(), records: this.records };
    this.records = [];
    return log;
  }

  /** retry: re-send an identical pay request (same key+student+amount) right after the original settled. */
  private async fire(retry?: Req) {
    const t = Date.now();
    const sc: ScenarioName = retry ? "pay" : pick();
    const q = retry ?? requests[sc]();
    let rec: ReqRecord;
    try {
      const res = await axios.request({ method: q.method, url: q.url, data: q.body, headers: q.headers, timeout: 10_000, validateStatus: () => true });
      rec = { t, scenario: sc, status: res.status, latencyMs: Date.now() - t, ...judge(sc, res.status, res.headers as any) };
    } catch (e) {
      rec = { t, scenario: sc, status: 0, ok: false, latencyMs: Date.now() - t, error: (e as Error).message };
    }
    if (!rec.degraded) delete rec.degraded;
    if (this.timer) this.records.push(rec);
    if (!retry && sc === "pay" && this.timer && Math.random() < 0.3) void this.fire(q); // 30% client-retry sim
  }
}

// ---------------------------------------------------------------- scenarios

type RunCtx = { node?: string };
interface ScenarioDef {
  inject: (ctx: RunCtx) => Promise<unknown> | void;
  recover?: () => Promise<unknown> | void; // run at +5s when ft
  clear?: (ctx: RunCtx) => Promise<unknown> | void;
  heal?: () => Promise<unknown> | void;
  affected: string[] | "all";
  rps?: number;
  observeMs?: number;
}

const SCENARIOS: Record<string, ScenarioDef> = {
  "app-crash": { inject: () => infra.crashInstance("records-service"), affected: ["transcript", "enroll"] },
  "db-failure": {
    inject: () => infra.killDbPrimary(), recover: () => infra.failoverDb(),
    heal: () => infra.healDb(), affected: ["transcript", "timetable", "enroll", "pay"],
  },
  "network-timeout": { inject: () => infra.setLatency("records-service", 5000), clear: () => infra.chaosResetAll(), affected: ["transcript", "enroll"] },
  "node-failure": {
    inject: async (ctx) => { ctx.node = await infra.stopNode(); },
    clear: async (ctx) => { if (ctx.node) await infra.startNode(ctx.node); },
    affected: "all",
  },
  // recovery needs ~10s tick + 30s updated_at guard in payment-service
  "corrupted-tx": { inject: () => infra.failMidwayOn(), clear: () => infra.chaosResetAll(), affected: ["pay"], observeMs: 120_000 },
  "high-load": { rps: 150, inject: () => {}, affected: "all" },
};

// ---------------------------------------------------------------- runner

async function runOne(name: string, ft: boolean) {
  const def = SCENARIOS[name];
  if (!def) throw new Error(`unknown scenario ${name}; have: ${Object.keys(SCENARIOS).join(", ")}`);
  const runId = `${name}-${ft ? "ft" : "baseline"}-${new Date().toISOString().replace(/:/g, "-")}`;
  const stage = (s: string) => console.log(`[${runId}] ${s}`);
  const health: HealthPoint[] = [];
  const load = new Loadgen();
  let poller: NodeJS.Timeout | undefined;
  let injectedAt = 0, injected = false, cleared = false, loadRunning = false;
  const ctx: RunCtx = {};
  try {
    stage("reset");
    await reset();
    stage("config");
    await infra.setProbes(ft); // ft=true re-applies manifests (FT_MODE=on); setFtMode then fixes baseline
    await infra.setFtMode(ft);
    await infra.scaleAll(ft ? 3 : 1);
    await infra.rolloutAll();
    poller = setInterval(() => {
      for (const app of APPS) void probe(app).then((ok) => health.push({ t: Date.now(), app, ok }), () => health.push({ t: Date.now(), app, ok: false }));
    }, HEALTH_EVERY_MS);
    stage("load");
    load.start(def.rps ?? 30);
    loadRunning = true;
    stage("warmup");
    await sleep(WARMUP_MS);
    stage("inject");
    injectedAt = Date.now();
    injected = true;
    await def.inject(ctx);
    if (ctx.node) stage(`node stopped: ${ctx.node}`);
    stage("observe");
    const observe = def.observeMs ?? OBSERVE_MS;
    if (def.recover && ft) {
      await sleep(FAILOVER_AT_MS);
      await def.recover();
      await sleep(Math.max(0, observe - FAILOVER_AT_MS));
    } else await sleep(observe);
    stage("stop"); // measured window ends here; clear/heal must not leak into it
    const log = load.stop();
    loadRunning = false;
    clearInterval(poller); poller = undefined;
    stage("clear");
    if (def.clear) await def.clear(ctx);
    if (def.heal) await def.heal();
    cleared = true;
    let c: { duplicates?: number; inconsistent?: number } = {};
    try {
      if (ft) { stage("settle"); c = await settled(); } // checkpointing recovery takes ~40s
      else { stage("analyze"); c = await consistency(); } // baseline: the inconsistency IS the finding
    } catch (e: any) { stage(`consistency check failed: ${e?.message ?? e}`); }
    const data = {
      runId, scenario: name, ft, injectedAt, affected: def.affected, records: log.records, health,
      windowStart: log.startedAt, windowEnd: log.stoppedAt, duplicatePayments: c.duplicates, inconsistentPayments: c.inconsistent,
    };
    const summary = summarize(data);
    await mkdir(RESULTS_DIR, { recursive: true });
    await writeFile(join(RESULTS_DIR, `${runId}.json`), JSON.stringify({ summary, ...data }, null, 1));
    stage(`done: ${JSON.stringify(summary)}`);
    return summary;
  } finally {
    if (poller) clearInterval(poller);
    if (loadRunning) load.stop();
    await infra.chaosResetAll().catch(() => {});
    if (!ft) await infra.setProbes(true).catch(() => {}); // baseline turned probes off; restore (safe: manifests carry no replicas)
    if (injected && !cleared) {
      // best-effort: undo node stop / db kill so the cluster is not left broken
      await Promise.resolve(def.clear?.(ctx)).catch(() => {});
      await Promise.resolve(def.heal?.()).catch(() => {});
    }
  }
}

async function csv(dir: string) {
  const { readdir, readFile } = await import("node:fs/promises");
  const head = "runId,scenario,ft,detection_ms,recovery_ms,total_requests,failed_requests,availability_pct,duplicate_payments,inconsistent_payments,impact_observed";
  const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const rows = [];
  for (const f of (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
    const s = JSON.parse(await readFile(join(dir, f), "utf8")).summary;
    if (s) rows.push([s.runId, s.scenario, s.ft, s.detectionMs, s.recoveryMs, s.totalRequests, s.failedRequests, s.availabilityPct.toFixed(2), s.duplicatePayments, s.inconsistentPayments, s.impactObserved].map(cell).join(","));
  }
  console.log([head, ...rows].join("\n"));
}

async function main() {
  const [what = "matrix", mode = "both"] = process.argv.slice(2);
  if (what === "reset") { await reset(); console.log("reset done"); return; }
  if (what === "csv") { await csv(mode === "both" ? RESULTS_DIR : mode); return; }
  const scenarios = what === "matrix" ? Object.keys(SCENARIOS) : [what];
  const modes = what === "matrix" || mode === "both" ? [false, true] : [mode === "ft"];
  const summaries = [];
  for (const s of scenarios) for (const ft of modes) {
    try { summaries.push(await runOne(s, ft)); }
    catch (e: any) { console.error(`[${s} ${ft ? "ft" : "baseline"}] FAILED: ${e?.message ?? e}`); process.exitCode = 1; }
  }
  console.table(summaries.map((s) => ({
    scenario: s.scenario, ft: s.ft, "detect ms": s.detectionMs, "recover ms": s.recoveryMs,
    total: s.totalRequests, failed: s.failedRequests, "avail %": s.availabilityPct.toFixed(2),
    dup: s.duplicatePayments, bad: s.inconsistentPayments,
  })));
}

void main();
