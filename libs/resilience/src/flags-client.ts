export type FlagName = "retry" | "timeout" | "circuitBreaker" | "idempotency" | "checkpointing" | "gracefulDegradation" | "healthChecks";

export const ALL_FLAGS: FlagName[] = ["retry", "timeout", "circuitBreaker", "idempotency", "checkpointing", "gracefulDegradation", "healthChecks"];

// ponytail: all mechanisms toggle together via FT_MODE env (on|off, default on), set per deployment with
// `kubectl set env`. A per-flag flags-service existed before; per-mechanism toggles were never exercised.
export class FlagsClient {
  private readonly on: boolean;

  constructor(on = process.env.FT_MODE !== "off") { this.on = on; }

  isOn(_flag: FlagName): boolean { return this.on; }
  snapshot(): Record<FlagName, boolean> {
    return Object.fromEntries(ALL_FLAGS.map((f) => [f, this.on])) as Record<FlagName, boolean>;
  }
}
