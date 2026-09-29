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
});
