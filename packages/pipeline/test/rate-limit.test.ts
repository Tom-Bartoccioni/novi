import { describe, expect, it } from 'vitest';
import { createLimiter, sleep } from '../src/lib/rate-limit';

describe('createLimiter', () => {
  it('spaces calls by at least 1/perSecond', async () => {
    const limiter = createLimiter(20); // 50 ms
    const t0 = Date.now();
    await limiter(async () => 1);
    await limiter(async () => 2);
    await limiter(async () => 3);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
  });
  it('returns the wrapped result', async () => {
    const limiter = createLimiter(1000);
    expect(await limiter(async () => 'ok')).toBe('ok');
  });
  it('sleep resolves', async () => {
    await expect(sleep(5)).resolves.toBeUndefined();
  });
  it('only spaces the starts and lets slow calls overlap', async () => {
    const limiter = createLimiter(1000);
    let inFlight = 0;
    let maxInFlight = 0;
    const t0 = Date.now();
    await Promise.all(
      Array.from({ length: 5 }, () =>
        limiter(async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await sleep(100);
          inFlight -= 1;
        }),
      ),
    );
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
    expect(Date.now() - t0).toBeLessThan(300);
  });
  it('does not block the next call when a wrapped call rejects', async () => {
    const limiter = createLimiter(1000);
    await expect(
      limiter(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await limiter(async () => 'next')).toBe('next');
  });
});
