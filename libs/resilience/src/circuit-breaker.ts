export class CircuitOpenError extends Error {
  constructor(name: string) { super(`Circuit "${name}" is open`); this.name = "CircuitOpenError"; }
}

type State = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreaker {
  private _state: State = "CLOSED";
  private failures = 0;
  private openedAt = 0;

  constructor(private opts: { failureThreshold: number; openMs: number; name: string }) {}

  get state(): State {
    if (this._state === "OPEN" && Date.now() - this.openedAt >= this.opts.openMs) return "HALF_OPEN";
    return this._state;
  }

  async exec<T>(fn: () => Promise<T>, enabled: boolean): Promise<T> {
    if (!enabled) return fn();
    const s = this.state;
    if (s === "OPEN") throw new CircuitOpenError(this.opts.name);
    try {
      const result = await fn();
      this._state = "CLOSED";
      this.failures = 0;
      return result;
    } catch (err) {
      this.failures += 1;
      if (s === "HALF_OPEN" || this.failures >= this.opts.failureThreshold) {
        this._state = "OPEN";
        this.openedAt = Date.now();
        this.failures = 0;
      }
      throw err;
    }
  }
}
