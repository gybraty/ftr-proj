import { Controller, Get, Header, Inject, Optional, ServiceUnavailableException } from "@nestjs/common";
import { metricsHandler } from "./metrics";
import { READINESS_CHECK } from "./tokens";

@Controller()
export class HealthController {
  constructor(@Optional() @Inject(READINESS_CHECK) private readiness?: () => Promise<unknown>) {}

  @Get("health")
  health() { return { status: "ok" }; }

  @Get("ready")
  async ready() {
    try { await this.readiness?.(); } catch { throw new ServiceUnavailableException({ status: "not ready" }); }
    return { status: "ready" };
  }

  @Get("metrics")
  @Header("Content-Type", "text/plain; version=0.0.4")
  metrics() { return metricsHandler(); }
}
