import { of, lastValueFrom } from "rxjs";
import { ChaosInterceptor } from "./chaos.interceptor";
import { ChaosService } from "./chaos.controller";

const ctx = (path: string) => ({ switchToHttp: () => ({ getRequest: () => ({ path }) }) }) as any;

async function timed(i: ChaosInterceptor, path: string) {
  const t = Date.now();
  await lastValueFrom(i.intercept(ctx(path), { handle: () => of("ok") }));
  return Date.now() - t;
}

describe("ChaosInterceptor", () => {
  const chaos = new ChaosService();
  const i = new ChaosInterceptor(chaos);
  beforeAll(() => { chaos.latencyMs = 200; });

  it("delays normal routes", async () => { expect(await timed(i, "/schedule")).toBeGreaterThanOrEqual(190); });

  it.each(["/health", "/ready", "/metrics", "/chaos/reset", "/admin/cache-reset"])("does not delay %s", async (p) => {
    expect(await timed(i, p)).toBeLessThan(100);
  });
});
