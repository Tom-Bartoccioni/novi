import { crawlRuns, createDb, jobOffers, migrateAndSeed } from '@novi/db';
import { desc } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refresh } from '../src/steps/refresh';

function setup() {
  const db = createDb(':memory:');
  migrateAndSeed(db);
  db.insert(jobOffers).values({ id: 'OLD', title: 'Ancienne', createdAt: '2026-01-01T00:00:00.000Z' }).run();
  return db;
}

const okStats = { processed: 0, created: 0, updated: 0, errors: 0 };

afterEach(() => {
  process.exitCode = undefined;
});

describe('refresh', () => {
  it('runs offers, match and signals, and counts new and linked offers', async () => {
    const db = setup();
    const steps = {
      hasCredentials: () => true,
      ingestOffres: vi.fn(async () => {
        db.insert(jobOffers)
          .values([
            { id: 'N1', title: 'Nouvelle', siren: null },
            { id: 'N2', title: 'Nouvelle 2' },
          ])
          .run();
        return { runId: 1, stats: { processed: 2, created: 2, updated: 0, errors: 0 }, errors: [] };
      }),
      matchOffres: vi.fn(async () => ({
        runId: 2,
        stats: { processed: 2, created: 0, updated: 1, errors: 0, matched: 1 },
        errors: [],
      })),
      computeSignals: vi.fn(async () => ({ runId: 3, stats: { ...okStats }, errors: [] })),
    };
    const result = await refresh(db, { departement: '06' }, steps);
    expect(result).toEqual({ newOffers: 2, linked: 1, failed: [] });
    expect(steps.ingestOffres).toHaveBeenCalledWith(db, { departement: '06' });
    const run = db.select().from(crawlRuns).orderBy(desc(crawlRuns.id)).get();
    expect(run?.command).toBe('refresh');
    expect(run?.stats).toMatchObject({ newOffers: 2, linked: 1 });
    expect(run?.finishedAt).not.toBeNull();
    expect(process.exitCode).toBeUndefined();
  });
  it('continues after a failed step and reports it', async () => {
    const db = setup();
    const steps = {
      hasCredentials: () => true,
      ingestOffres: vi.fn(async () => {
        throw new Error('boom');
      }),
      matchOffres: vi.fn(async () => ({ runId: 2, stats: { ...okStats, matched: 0 }, errors: [] })),
      computeSignals: vi.fn(async () => ({ runId: 3, stats: { ...okStats }, errors: [] })),
    };
    const result = await refresh(db, { departement: '06' }, steps);
    expect(result.failed).toEqual(['ingest offres']);
    expect(steps.matchOffres).toHaveBeenCalled();
    expect(steps.computeSignals).toHaveBeenCalled();
    const run = db.select().from(crawlRuns).orderBy(desc(crawlRuns.id)).get();
    expect(run?.errors).toEqual([{ message: 'ingest offres : boom' }]);
    expect(process.exitCode).toBe(1);
  });
  it('reports zero linked offers when the match step fails', async () => {
    const db = setup();
    const steps = {
      hasCredentials: () => true,
      ingestOffres: vi.fn(async () => ({ runId: 1, stats: { ...okStats }, errors: [] })),
      matchOffres: vi.fn(async () => {
        throw new Error('rattachement impossible');
      }),
      computeSignals: vi.fn(async () => ({ runId: 3, stats: { ...okStats }, errors: [] })),
    };
    const result = await refresh(db, { departement: '06' }, steps);
    expect(result).toEqual({ newOffers: 0, linked: 0, failed: ['match offres'] });
    expect(steps.computeSignals).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
  it('stops immediately without credentials', async () => {
    const db = setup();
    const steps = {
      hasCredentials: () => false,
      ingestOffres: vi.fn(),
      matchOffres: vi.fn(),
      computeSignals: vi.fn(),
    };
    const result = await refresh(db, { departement: '06' }, steps);
    expect(result).toEqual({ newOffers: 0, linked: 0, failed: ['credentials'] });
    expect(steps.ingestOffres).not.toHaveBeenCalled();
    expect(db.select().from(crawlRuns).all()).toHaveLength(0);
    expect(process.exitCode).toBe(1);
  });
});
