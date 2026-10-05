export class TimeoutError extends Error {
  constructor(ms: number) { super(`Timed out after ${ms}ms`); this.name = "TimeoutError"; }
}

export async function withTimeout<T>(fn: () => Promise<T>, ms: number, enabled: boolean): Promise<T> {
  if (!enabled) return fn();
  let timer: NodeJS.Timeout;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new TimeoutError(ms)), ms); }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
