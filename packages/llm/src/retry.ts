import { LLMError } from './types.js';

export interface RetryOpts { retries?: number; baseMs?: number; maxMs?: number; sleep?: (ms: number) => Promise<void> }

/** Exponential backoff with full jitter; honours Retry-After (per Model API rate-limit guidance). */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  const base = opts.baseMs ?? 500;
  const max = opts.maxMs ?? 20_000;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      const retryable = e instanceof LLMError ? e.retryable : e instanceof TypeError; // network errors
      if (!retryable || attempt >= retries) throw e;
      const backoff = Math.min(max, base * 2 ** attempt);
      const jitter = Math.random() * backoff;
      const ra = e instanceof LLMError && e.retryAfterMs ? e.retryAfterMs : 0;
      await sleep(Math.max(ra, jitter));
    }
  }
}

export function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s)) return s * 1000;
  const d = Date.parse(h);
  return Number.isFinite(d) ? Math.max(0, d - Date.now()) : undefined;
}
