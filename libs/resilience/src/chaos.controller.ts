import { CanActivate, Body, Controller, ExecutionContext, ForbiddenException, HttpCode, Inject, Injectable, Optional, Post, UseGuards } from "@nestjs/common";
import { CACHE_RESET_HOOK } from "./tokens";

@Injectable()
export class ChaosService {
  latencyMs = 0;
  custom = new Map<string, unknown>();

  async maybeDelay(): Promise<void> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  reset(): void {
    this.latencyMs = 0;
    this.custom.clear();
  }
}

@Injectable()
export class ChaosTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const expected = process.env.CHAOS_TOKEN;
    const got = ctx.switchToHttp().getRequest().headers["x-chaos-token"];
    if (!expected || got !== expected) throw new ForbiddenException("invalid chaos token");
    return true;
  }
}

@Controller()
@UseGuards(ChaosTokenGuard)
export class ChaosController {
  constructor(
    private chaos: ChaosService,
    @Optional() @Inject(CACHE_RESET_HOOK) private cacheResetHook?: () => void | Promise<void>,
  ) {}

  @Post("chaos/crash")
  @HttpCode(200)
  crash() {
    setTimeout(() => process.exit(1), 100);
    return { crashing: true };
  }

  @Post("chaos/latency")
  @HttpCode(200)
  latency(@Body() body: { ms: number }) {
    this.chaos.latencyMs = Number(body?.ms) > 0 ? Number(body.ms) : 0;
    return { latencyMs: this.chaos.latencyMs };
  }

  @Post("chaos/reset")
  @HttpCode(200)
  reset() {
    this.chaos.reset();
    return { reset: true };
  }

  @Post("admin/cache-reset")
  @HttpCode(200)
  async cacheReset() {
    this.chaos.reset();
    await this.cacheResetHook?.();
    return { reset: true };
  }
}
