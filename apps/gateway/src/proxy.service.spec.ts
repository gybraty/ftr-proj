import { CircuitOpenError } from "@ftr/resilience";
import { ProxyService } from "./proxy.service";

function setup(impl: (t: string, c: any) => any = async () => ({ status: 200, headers: {}, data: { ok: 1 } })) {
  const requestFull = jest.fn(impl);
  return { requestFull, svc: new ProxyService({ requestFull, breakerStates: () => ({}) } as any) };
}

describe("ProxyService", () => {
  it.each([
    ["/api/students/1", "student", "http://student-service:3001/students/1"],
    ["/api/enrollments", "student", "http://student-service:3001/enrollments"],
    ["/api/payments", "payment", "http://payment-service:3002/payments"],
    ["/api/transcripts/1", "records", "http://records-service:3003/transcripts/1"],
    ["/api/eligibility/1?course=2", "records", "http://records-service:3003/eligibility/1?course=2"],
    ["/api/timetables/1", "timetable", "http://timetable-service:3004/timetables/1"],
  ])("%s -> %s", async (path, target, url) => {
    const { svc, requestFull } = setup();
    await svc.forward("GET", path, undefined, {});
    expect(requestFull).toHaveBeenCalledWith(target, expect.objectContaining({ url, method: "GET" }));
  });

  it("unknown prefix -> 404 without upstream call", async () => {
    const { svc, requestFull } = setup();
    expect((await svc.forward("GET", "/api/nope", undefined, {})).status).toBe(404);
    expect((await svc.forward("GET", "/api/constructor", undefined, {})).status).toBe(404);
    expect(requestFull).not.toHaveBeenCalled();
  });

  it("forwards body and Idempotency-Key only", async () => {
    const { svc, requestFull } = setup();
    await svc.forward("POST", "/api/payments", { a: 1 }, { "idempotency-key": "k1", cookie: "x" });
    const cfg = requestFull.mock.calls[0][1];
    expect(cfg.data).toEqual({ a: 1 });
    expect(cfg.headers).toEqual({ "Idempotency-Key": "k1" });
  });

  it("409 passes through", async () => {
    const { svc } = setup(async () => ({ status: 409, headers: {}, data: { e: "dup" } }));
    expect(await svc.forward("POST", "/api/enrollments", {}, {})).toEqual({ status: 409, headers: {}, body: { e: "dup" } });
  });

  it("forwards X-Degraded headers", async () => {
    const { svc } = setup(async () => ({ status: 200, headers: { "x-degraded": "records", "x-degraded-at": "t", other: "z" }, data: {} }));
    expect((await svc.forward("GET", "/api/transcripts/1", undefined, {})).headers).toEqual({ "X-Degraded": "records", "X-Degraded-At": "t" });
  });

  it("CircuitOpenError -> 503", async () => {
    const { svc } = setup(async () => { throw new CircuitOpenError("records"); });
    expect(await svc.forward("GET", "/api/transcripts/1", undefined, {})).toMatchObject({ status: 503, body: { error: "circuit-open", target: "records" } });
  });

  it("other failure -> 502", async () => {
    const { svc } = setup(async () => { throw new Error("ECONNREFUSED"); });
    expect(await svc.forward("GET", "/api/payments", undefined, {})).toMatchObject({ status: 502, body: { error: "bad-gateway", target: "payment" } });
  });
});
