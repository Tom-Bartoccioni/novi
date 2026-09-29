import { crawlRuns, createDb, migrateAndSeed, techTags } from '@novi/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withRun } from '../src/lib/run';

describe('withRun', () => {
  it('records stats and errors, and never throws for per-item errors', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    const result = await withRun(db, 'test', { limit: 2 }, async (ctx) => {
      ctx.stats.processed = 2;
      ctx.stats.created = 1;
      ctx.error('000000001', new Error('boom'));
    });
    expect(result.stats).toMatchObject({ processed: 2, created: 1, errors: 1 });
    const row = db.select().from(crawlRuns).get();
    expect(row?.command).toBe('test');
    expect(row?.args).toEqual({ limit: 2 });
    expect(row?.finishedAt).toBeTruthy();
    expect(row?.errors).toEqual([{ siren: '000000001', message: 'boom' }]);
    expect(result.runId).toBe(row?.id);
  });
  it('still closes the run when the step throws, then rethrows', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    await expect(
      withRun(db, 'test', {}, async () => {
        throw new Error('fatal');
      }),
    ).rejects.toThrow('fatal');
    const row = db.select().from(crawlRuns).get();
    expect(row?.finishedAt).toBeTruthy();
    expect(row?.errors).toEqual([{ message: 'fatal' }]);
  });
  it('synchronises the tech tags dictionary before the run starts', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    db.delete(techTags).where(eq(techTags.slug, 'react')).run();
    expect(db.select().from(techTags).where(eq(techTags.slug, 'react')).get()).toBeUndefined();
    await withRun(db, 'test', {}, async () => {});
    expect(db.select().from(techTags).where(eq(techTags.slug, 'react')).get()?.label).toBe('React');
  });
});
