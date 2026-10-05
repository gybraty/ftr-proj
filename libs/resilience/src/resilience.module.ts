import { APP_INTERCEPTOR } from "@nestjs/core";
import { DynamicModule, Global, Module } from "@nestjs/common";
import { FlagsClient } from "./flags-client";
import { ChaosController, ChaosService, ChaosTokenGuard } from "./chaos.controller";
import { ChaosInterceptor } from "./chaos.interceptor";
import { HealthController } from "./health.controller";
import { MetricsInterceptor } from "./metrics.interceptor";
import { ResilientHttp } from "./resilient-http";
import { CACHE_RESET_HOOK, READINESS_CHECK, SERVICE_NAME } from "./tokens";

export interface ResilienceOptions {
  serviceName: string;
  /** optional: async fn backing GET /ready (throw = 503) */
  readinessCheck?: () => Promise<unknown>;
  /** optional: extra work for POST /admin/cache-reset */
  cacheResetHook?: () => void | Promise<void>;
}

@Global()
@Module({})
export class ResilienceModule {
  static forRoot(opts: ResilienceOptions): DynamicModule {
    const flagsProvider = { provide: FlagsClient, useFactory: () => new FlagsClient() };
    const exported = [FlagsClient, ChaosService, ResilientHttp, MetricsInterceptor, SERVICE_NAME];
    return {
      module: ResilienceModule,
      controllers: [ChaosController, HealthController],
      providers: [
        { provide: SERVICE_NAME, useValue: opts.serviceName },
        { provide: READINESS_CHECK, useValue: opts.readinessCheck },
        { provide: CACHE_RESET_HOOK, useValue: opts.cacheResetHook },
        flagsProvider,
        ChaosService,
        ChaosTokenGuard,
        MetricsInterceptor,
        { provide: APP_INTERCEPTOR, useClass: ChaosInterceptor },
        { provide: ResilientHttp, useFactory: (flags: FlagsClient) => new ResilientHttp({ flags, serviceName: opts.serviceName }), inject: [FlagsClient] },
      ],
      exports: exported,
    };
  }
}
