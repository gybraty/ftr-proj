import { withTimeout, TimeoutError } from "./timeout";

describe("withTimeout", () => {
  it("resolves when fn finishes in time", async () => {
    await expect(withTimeout(() => Promise.resolve(42), 100, true)).resolves.toBe(42);
  });

  it("rejects with TimeoutError when fn is slow", async () => {
    const slow = () => new Promise((r) => setTimeout(r, 200));
    await expect(withTimeout(slow, 20, true)).rejects.toBeInstanceOf(TimeoutError);
  });

  it("enabled=false never times out", async () => {
    const slow = () => new Promise<string>((r) => setTimeout(() => r("done"), 100));
    await expect(withTimeout(slow, 10, false)).resolves.toBe("done");
  });
});
