import { CircuitBreaker, CircuitOpenError } from "./circuit-breaker";

const fail = () => Promise.reject(new Error("down"));
const ok = () => Promise.resolve("ok");

describe("CircuitBreaker", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("opens after threshold consecutive failures", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 1000, name: "t" });
    for (let i = 0; i < 3; i++) await expect(cb.exec(fail, true)).rejects.toThrow("down");
    expect(cb.state).toBe("OPEN");
    await expect(cb.exec(ok, true)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("success resets consecutive-failure counter", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 1000, name: "t" });
    await expect(cb.exec(fail, true)).rejects.toThrow();
    await expect(cb.exec(fail, true)).rejects.toThrow();
    await expect(cb.exec(ok, true)).resolves.toBe("ok");
    await expect(cb.exec(fail, true)).rejects.toThrow();
    expect(cb.state).toBe("CLOSED");
  });

  it("half-opens after openMs and closes on probe success", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 1000, name: "t" });
    await expect(cb.exec(fail, true)).rejects.toThrow();
    expect(cb.state).toBe("OPEN");
    jest.advanceTimersByTime(1001);
    await expect(cb.exec(ok, true)).resolves.toBe("ok");
    expect(cb.state).toBe("CLOSED");
  });

  it("returns to OPEN with fresh timer when half-open probe fails", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 1000, name: "t" });
    await expect(cb.exec(fail, true)).rejects.toThrow();
    jest.advanceTimersByTime(1001);
    await expect(cb.exec(fail, true)).rejects.toThrow("down");
    expect(cb.state).toBe("OPEN");
    jest.advanceTimersByTime(500);
    await expect(cb.exec(ok, true)).rejects.toBeInstanceOf(CircuitOpenError); // still open
    jest.advanceTimersByTime(501);
    await expect(cb.exec(ok, true)).resolves.toBe("ok");
  });

  it("enabled=false passes through and does not mutate state", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 1000, name: "t" });
    for (let i = 0; i < 5; i++) await expect(cb.exec(fail, false)).rejects.toThrow("down");
    expect(cb.state).toBe("CLOSED");
  });
});
