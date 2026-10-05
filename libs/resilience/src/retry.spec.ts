import { retryWithBackoff } from "./retry";

describe("retryWithBackoff", () => {
  it("returns result on first success without retrying", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    await expect(retryWithBackoff(fn, { retries: 3, baseMs: 1, enabled: true })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to N times then succeeds", async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue("ok");
    const onRetry = jest.fn();
    await expect(retryWithBackoff(fn, { retries: 3, baseMs: 1, enabled: true, onRetry })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("throws last error after exhausting retries", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("dead"));
    await expect(retryWithBackoff(fn, { retries: 2, baseMs: 1, enabled: true })).rejects.toThrow("dead");
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("enabled=false means exactly one attempt", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("dead"));
    await expect(retryWithBackoff(fn, { retries: 5, baseMs: 1, enabled: false })).rejects.toThrow("dead");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("delays grow exponentially and cap at maxMs", async () => {
    jest.useFakeTimers();
    const delays: number[] = [];
    const origSetTimeout = global.setTimeout;
    jest.spyOn(global, "setTimeout").mockImplementation(((cb: any, ms: any) => {
      delays.push(ms); return origSetTimeout(cb, 0);
    }) as any);
    const fn = jest.fn().mockRejectedValue(new Error("x"));
    const p = retryWithBackoff(fn, { retries: 4, baseMs: 100, factor: 2, maxMs: 500, enabled: true }).catch(() => {});
    await jest.runAllTimersAsync();
    await p;
    expect(delays).toEqual([100, 200, 400, 500]);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
});
