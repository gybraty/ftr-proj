export type ScenarioName = "register" | "enroll" | "pay" | "transcript" | "timetable";
export interface ReqRecord { t: number; scenario: ScenarioName; status: number; ok: boolean; latencyMs: number; degraded?: boolean; error?: string }

export interface HealthPoint { t: number; app: string; ok: boolean }
export interface ExperimentSummary {
  runId: string; scenario: string; ft: boolean; injectedAt: number;
  detectionMs: number | null; recoveryMs: number | null; impactObserved: boolean;
  totalRequests: number; failedRequests: number; availabilityPct: number;
  duplicatePayments?: number; inconsistentPayments?: number;
}
export interface RunData {
  runId: string; scenario: string; ft: boolean; injectedAt: number;
  affected: string[] | "all"; records: ReqRecord[]; health: HealthPoint[];
  windowStart?: number; windowEnd?: number;
  duplicatePayments?: number; inconsistentPayments?: number;
}

const STREAK = 10;

export function detectionTime(health: HealthPoint[], injectedAt: number): number | null {
  const bad = health.filter((h) => !h.ok && h.t >= injectedAt).sort((a, b) => a.t - b.t)[0];
  return bad ? bad.t - injectedAt : null;
}

export function recoveryTime(records: ReqRecord[], injectedAt: number, affected: string[] | "all"): number | null {
  const rs = records
    .filter((r) => r.t >= injectedAt && (affected === "all" || affected.includes(r.scenario)))
    .sort((a, b) => a.t - b.t);
  const first = rs.findIndex((r) => !r.ok); // anchor: streaks before the first failure are not recovery
  if (first < 0) return null;
  let run = 0;
  for (let i = first; i < rs.length; i++) {
    run = rs[i].ok ? run + 1 : 0;
    if (run === STREAK) return rs[i - STREAK + 1].t - injectedAt;
  }
  return null;
}

export function impactObserved(records: ReqRecord[], injectedAt: number, affected: string[] | "all"): boolean {
  return records.some((r) => r.t >= injectedAt && !r.ok && (affected === "all" || affected.includes(r.scenario)));
}

export function availability(records: ReqRecord[], windowStart = -Infinity, windowEnd = Infinity): number {
  const w = records.filter((r) => r.t >= windowStart && r.t <= windowEnd);
  return w.length ? (100 * w.filter((r) => r.ok).length) / w.length : 100;
}

export function summarize(run: RunData): ExperimentSummary {
  const failed = run.records.filter((r) => !r.ok).length;
  const s: ExperimentSummary = {
    runId: run.runId, scenario: run.scenario, ft: run.ft, injectedAt: run.injectedAt,
    detectionMs: detectionTime(run.health, run.injectedAt),
    recoveryMs: recoveryTime(run.records, run.injectedAt, run.affected),
    impactObserved: impactObserved(run.records, run.injectedAt, run.affected),
    totalRequests: run.records.length, failedRequests: failed,
    availabilityPct: availability(run.records, run.windowStart, run.windowEnd),
  };
  if (run.duplicatePayments !== undefined) s.duplicatePayments = run.duplicatePayments;
  if (run.inconsistentPayments !== undefined) s.inconsistentPayments = run.inconsistentPayments;
  return s;
}
