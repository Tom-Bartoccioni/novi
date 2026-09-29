import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../src/lib/retry';

const retryable = (err: unknown) => err instanceof Error && err.message === 'transient';

describe('withRetry', () => {
  it('retries a transient failure and returns the eventual result', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('ok');
    await expect(withRetry(fn, { retries: 3, isRetryable: retryable, baseDelayMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it('throws a non-retryable error immediately', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('fatal'));
    await expect(withRetry(fn, { retries: 3, isRetryable: retryable, baseDelayMs: 0 })).rejects.toThrow(
      'fatal',
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('gives up after the configured number of retries', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('transient'));
    await expect(withRetry(fn, { retries: 2, isRetryable: retryable, baseDelayMs: 0 })).rejects.toThrow(
      'transient',
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
