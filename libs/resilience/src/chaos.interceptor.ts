import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, from, switchMap } from "rxjs";
import { ChaosService } from "./chaos.controller";

// control/probe routes must stay responsive during injected latency
const EXEMPT = ["/chaos", "/admin", "/health", "/ready", "/metrics"];

@Injectable()
export class ChaosInterceptor implements NestInterceptor {
  constructor(private chaos: ChaosService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const path: string = req.path ?? String(req.url ?? "").split("?")[0];
    if (EXEMPT.some((p) => path === p || path.startsWith(p + "/"))) return next.handle();
    return from(this.chaos.maybeDelay()).pipe(switchMap(() => next.handle()));
  }
}
