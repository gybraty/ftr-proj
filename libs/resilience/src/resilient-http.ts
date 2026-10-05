import axios, { AxiosRequestConfig } from "axios";
import { FlagsClient } from "./flags-client";
import { CircuitBreaker } from "./circuit-breaker";
import { retryWithBackoff } from "./retry";
import { withTimeout } from "./timeout";
import { retryAttemptsTotal, circuitState } from "./metrics";

export interface ResilientHttpTuning {
  timeoutMs?: number; retries?: number; baseMs?: number; breakerThreshold?: number; openMs?: number;
}

export class ResilientHttp {
  private breakers = new Map<string, CircuitBreaker>();
  private t: Required<ResilientHttpTuning>;

  constructor(private deps: { flags: FlagsClient; serviceName: string }, tuning: ResilientHttpTuning = {}) {
    this.t = { timeoutMs: 2000, retries: 3, baseMs: 200, breakerThreshold: 5, openMs: 10000, ...tuning };
  }

  private breaker(target: string): CircuitBreaker {
    if (!this.breakers.has(target)) {
      this.breakers.set(target, new CircuitBreaker({ failureThreshold: this.t.breakerThreshold, openMs: this.t.openMs, name: target }));
      circuitState.set({ service: this.deps.serviceName, target }, 0);
    }
    return this.breakers.get(target)!;
  }

  breakerStates(): Record<string, string> {
    return Object.fromEntries([...this.breakers].map(([k, b]) => [k, b.state]));
  }

  async request<T>(target: string, config: AxiosRequestConfig): Promise<T> {
    return (await this.requestFull<T>(target, config)).data;
  }

  async requestFull<T>(target: string, config: AxiosRequestConfig): Promise<{ status: number; headers: Record<string, unknown>; data: T }> {
    const { flags, serviceName } = this.deps;
    const cb = this.breaker(target);
    try {
      return await cb.exec(
        () => retryWithBackoff(
          () => withTimeout(async () => {
            const res = await axios({ ...config, validateStatus: (s) => s < 500 });
            return { status: res.status, headers: { ...res.headers } as Record<string, unknown>, data: res.data as T };
          }, this.t.timeoutMs, flags.isOn("timeout")),
          {
            retries: this.t.retries, baseMs: this.t.baseMs, enabled: flags.isOn("retry"),
            onRetry: () => retryAttemptsTotal.inc({ service: serviceName, target }),
          },
        ),
        flags.isOn("circuitBreaker"),
      );
    } finally {
      circuitState.set({ service: serviceName, target }, { CLOSED: 0, HALF_OPEN: 1, OPEN: 2 }[cb.state]);
    }
  }

  get<T>(target: string, url: string, config: AxiosRequestConfig = {}): Promise<T> { return this.request(target, { ...config, method: "GET", url }); }
  post<T>(target: string, url: string, data?: unknown, config: AxiosRequestConfig = {}): Promise<T> { return this.request(target, { ...config, method: "POST", url, data }); }
}
