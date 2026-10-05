import { Injectable } from "@nestjs/common";
import { CircuitOpenError, ResilientHttp } from "@ftr/resilience";

export interface ProxyResult { status: number; headers: Record<string, string>; body: unknown }

// prefix -> [breaker target name, env var, default URL]
const ROUTES: Record<string, [string, string, string]> = {
  students: ["student", "STUDENT_URL", "http://student-service:3001"],
  enrollments: ["student", "STUDENT_URL", "http://student-service:3001"],
  payments: ["payment", "PAYMENT_URL", "http://payment-service:3002"],
  transcripts: ["records", "RECORDS_URL", "http://records-service:3003"],
  eligibility: ["records", "RECORDS_URL", "http://records-service:3003"],
  timetables: ["timetable", "TIMETABLE_URL", "http://timetable-service:3004"],
};

@Injectable()
export class ProxyService {
  constructor(private http: ResilientHttp) {}

  breakers() { return this.http.breakerStates(); }

  /** path is the original URL incl. /api prefix and query string */
  async forward(method: string, path: string, body: unknown, reqHeaders: Record<string, unknown>): Promise<ProxyResult> {
    const rest = path.replace(/^\/api/, "");
    const prefix = rest.split(/[/?]/)[1] ?? "";
    const route = Object.hasOwn(ROUTES, prefix) ? ROUTES[prefix] : undefined;
    if (!route) return { status: 404, headers: {}, body: { error: "not-found" } };
    const [target, env, dflt] = route;
    const headers: Record<string, string> = {};
    const key = reqHeaders["idempotency-key"];
    if (typeof key === "string") headers["Idempotency-Key"] = key;
    try {
      const res = await this.http.requestFull(target, { method: method as any, url: (process.env[env] ?? dflt) + rest, data: body, headers });
      const out: Record<string, string> = {};
      if (res.headers["x-degraded"] != null) out["X-Degraded"] = String(res.headers["x-degraded"]);
      if (res.headers["x-degraded-at"] != null) out["X-Degraded-At"] = String(res.headers["x-degraded-at"]);
      return { status: res.status, headers: out, body: res.data };
    } catch (e) {
      if (e instanceof CircuitOpenError) return { status: 503, headers: {}, body: { error: "circuit-open", target } };
      return { status: 502, headers: {}, body: { error: "bad-gateway", target } };
    }
  }
}
