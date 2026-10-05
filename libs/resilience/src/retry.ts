export interface RetryOpts {
  retries: number;
  baseMs: number;
  factor?: number;
  maxMs?: number;
  enabled: boolean;
  onRetry?: (attempt: number) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function retryWithBackoff<T>(fn: () => Promise<T>, opts: RetryOpts): Promise<T> {
  const attempts = opts.enabled ? opts.retries + 1 : 1;
  const factor = opts.factor ?? 2;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        opts.onRetry?.(i + 1);
        const delay = Math.min(opts.baseMs * factor ** i, opts.maxMs ?? Infinity);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}
