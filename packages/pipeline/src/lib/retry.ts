import { sleep } from './rate-limit';

export type RetryOptions = {
  /** Nombre de nouvelles tentatives après le premier échec. */
  retries: number;
  isRetryable: (err: unknown) => boolean;
  /** Délai avant la première nouvelle tentative, doublé à chaque fois (0 dans les tests). */
  baseDelayMs?: number;
};

/** Rejoue `fn` sur erreur jugée transitoire, avec un délai exponentiel ; les autres erreurs sont relancées aussitôt. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= opts.retries || !opts.isRetryable(err)) throw err;
      const delay = baseDelayMs * 2 ** attempt;
      if (delay > 0) await sleep(delay);
    }
  }
}
