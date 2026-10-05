import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { httpRequestDuration } from "./metrics";
import { SERVICE_NAME } from "./tokens";

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(@Inject(SERVICE_NAME) private service: string) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const end = httpRequestDuration.startTimer();
    const done = (status: number) =>
      end({ service: this.service, route: req.route?.path ?? req.url, method: req.method, status });
    return next.handle().pipe(
      tap({
        next: () => done(res.statusCode),
        error: (e) => done(typeof e?.getStatus === "function" ? e.getStatus() : 500),
      }),
    );
  }
}
