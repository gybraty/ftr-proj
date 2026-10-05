import { availability, impactObserved, detectionTime, recoveryTime, summarize } from "./analysis";

const rec = (t: number, ok: boolean, scenario: any = "pay") => ({ t, ok, scenario, status: ok ? 200 : 500, latencyMs: 1 });
const oks = (from: number, n: number, sc: any = "pay") => Array.from({ length: n }, (_, i) => rec(from + i, true, sc));

describe("detectionTime", () => {
  it("first bad probe at/after inject", () => {
    const h = [{ t: 50, app: "a", ok: false }, { t: 1100, app: "a", ok: true }, { t: 1600, app: "b", ok: false }, { t: 2100, app: "a", ok: false }];
    expect(detectionTime(h, 1000)).toBe(600);
  });
  it("none -> null", () => expect(detectionTime([{ t: 2000, app: "a", ok: true }], 1000)).toBeNull());
});

describe("recoveryTime", () => {
  it("start of first 10-streak, ignores pre-inject", () => {
    const r = [...oks(0, 20), rec(1000, false), rec(1001, false), ...oks(1500, 10)];
    expect(recoveryTime(r, 1000, ["pay"])).toBe(500);
  });
  it("flapping then true streak", () => {
    const r = [rec(1000, true), rec(1001, false), rec(1002, true), rec(1003, false), ...oks(2000, 10)];
    expect(recoveryTime(r, 1000, "all")).toBe(1000);
  });
  it("pure flapping / short streak -> null", () => {
    const r = Array.from({ length: 30 }, (_, i) => rec(1000 + i, i % 2 === 0));
    expect(recoveryTime(r, 1000, "all")).toBeNull();
    expect(recoveryTime(oks(1000, 9), 1000, "all")).toBeNull();
  });
  it("no failure at all -> null (no instant streak at inject)", () => {
    const r = oks(1000, 30);
    expect(recoveryTime(r, 1000, "all")).toBeNull();
    expect(impactObserved(r, 1000, "all")).toBe(false);
  });
  it("failed but never recovered -> null with impact", () => {
    const r = [...oks(1000, 5), rec(1010, false), ...oks(1011, 9)];
    expect(recoveryTime(r, 1000, "all")).toBeNull();
    expect(impactObserved(r, 1000, "all")).toBe(true);
  });
  it("streak before first failure is ignored", () => {
    const r = [...oks(1000, 12), rec(1100, false), ...oks(1200, 10)];
    expect(recoveryTime(r, 1000, "all")).toBe(200);
  });
  it("only affected scenarios count", () => {
    const r = [...oks(1000, 20, "timetable"), rec(1100, false, "pay")];
    expect(recoveryTime(r, 1000, ["pay"])).toBeNull();
  });
});

describe("availability + summarize", () => {
  it("ok/total in window", () => {
    expect(availability([rec(1, true), rec(2, false), rec(3, true), rec(99, false)], 0, 10)).toBeCloseTo(66.67, 1);
  });
  it("summary shape", () => {
    const s = summarize({ runId: "x", scenario: "s", ft: true, injectedAt: 1000, affected: ["pay"], health: [{ t: 1200, app: "a", ok: false }],
      records: [rec(1000, false), ...oks(1001, 10)], duplicatePayments: 0, inconsistentPayments: 2 });
    expect(s).toEqual({ runId: "x", scenario: "s", ft: true, injectedAt: 1000, detectionMs: 200, recoveryMs: 1, impactObserved: true, totalRequests: 11, failedRequests: 1,
      availabilityPct: (100 * 10) / 11, duplicatePayments: 0, inconsistentPayments: 2 });
  });
});
