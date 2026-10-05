import client from "prom-client";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration",
  labelNames: ["service", "route", "method", "status"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const retryAttemptsTotal = new client.Counter({
  name: "retry_attempts_total", help: "Retry attempts", labelNames: ["service", "target"], registers: [registry],
});

export const circuitState = new client.Gauge({
  name: "circuit_breaker_state", help: "0 closed 1 half-open 2 open", labelNames: ["service", "target"], registers: [registry],
});

export const metricsHandler = () => registry.metrics();
