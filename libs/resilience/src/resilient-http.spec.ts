import http from "http";
import { ResilientHttp } from "./resilient-http";
import { FlagsClient } from "./flags-client";
import { CircuitOpenError } from "./circuit-breaker";
import { circuitState } from "./metrics";

async function gauge(service: string, target: string): Promise<number | undefined> {
  return (await circuitState.get()).values.find((v) => v.labels.service === service && v.labels.target === target)?.value;
}

function flaky(failTimes: number): Promise<{ url: string; close: () => void; calls: () => number }> {
  let calls = 0;
  return new Promise((resolve) => {
    const srv = http.createServer((_req, res) => {
      calls++;
      if (calls <= failTimes) { res.statusCode = 500; res.end("err"); return; }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
    srv.listen(0, () => resolve({ url: `http://127.0.0.1:${(srv.address() as any).port}`, close: () => srv.close(), calls: () => calls }));
  });
}

function allOn(): FlagsClient { return new FlagsClient(true); }
function allOff(): FlagsClient { return new FlagsClient(false); }

describe("ResilientHttp", () => {
  it("retries 500s and succeeds when flags on", async () => {
    const srv = await flaky(2);
    const rh = new ResilientHttp({ flags: allOn(), serviceName: "test" });
    await expect(rh.get("t", `${srv.url}/x`)).resolves.toEqual({ ok: true });
    expect(srv.calls()).toBe(3);
    srv.close();
  });

  it("single attempt when flags off", async () => {
    const srv = await flaky(2);
    const rh = new ResilientHttp({ flags: allOff(), serviceName: "test" });
    await expect(rh.get("t", `${srv.url}/x`)).rejects.toThrow();
    expect(srv.calls()).toBe(1);
    srv.close();
  });

  it("opens breaker after repeated exhausted retries", async () => {
    const srv = await flaky(Infinity as any);
    const rh = new ResilientHttp({ flags: allOn(), serviceName: "test" }, { retries: 0, breakerThreshold: 2, timeoutMs: 500, openMs: 60000 });
    await expect(rh.get("t", `${srv.url}/x`)).rejects.toThrow();
    await expect(rh.get("t", `${srv.url}/x`)).rejects.toThrow();
    await expect(rh.get("t", `${srv.url}/x`)).rejects.toBeInstanceOf(CircuitOpenError);
    srv.close();
  });

  it("circuit gauge tracks OPEN (incl. short-circuit) and recovery", async () => {
    const srv = await flaky(2);
    const rh = new ResilientHttp({ flags: allOn(), serviceName: "gauge" }, { retries: 0, breakerThreshold: 2, timeoutMs: 500, openMs: 100 });
    await expect(rh.get("g", `${srv.url}/x`)).rejects.toThrow();
    expect(await gauge("gauge", "g")).toBe(0);
    await expect(rh.get("g", `${srv.url}/x`)).rejects.toThrow();
    expect(await gauge("gauge", "g")).toBe(2);
    await expect(rh.get("g", `${srv.url}/x`)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(await gauge("gauge", "g")).toBe(2);
    await new Promise((r) => setTimeout(r, 150));
    await expect(rh.get("g", `${srv.url}/x`)).resolves.toEqual({ ok: true });
    expect(await gauge("gauge", "g")).toBe(0);
    srv.close();
  });

  it("requestFull passes 4xx status and headers through without retry", async () => {
    const srv = await new Promise<any>((resolve) => {
      let calls = 0;
      const h = http.createServer((_q, res) => { calls++; res.statusCode = 409; res.setHeader("x-degraded", "true"); res.setHeader("content-type", "application/json"); res.end('{"e":1}'); });
      h.listen(0, () => resolve({ url: `http://127.0.0.1:${(h.address() as any).port}`, close: () => h.close(), calls: () => calls }));
    });
    const rh = new ResilientHttp({ flags: allOn(), serviceName: "test" });
    const r = await rh.requestFull("t", { method: "GET", url: `${srv.url}/x` });
    expect(r.status).toBe(409);
    expect(r.headers["x-degraded"]).toBe("true");
    expect(r.data).toEqual({ e: 1 });
    expect(srv.calls()).toBe(1);
    srv.close();
  });
});
