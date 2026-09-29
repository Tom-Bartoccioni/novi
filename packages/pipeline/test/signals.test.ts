import { companies, createDb, jobOffers, migrateAndSeed, replaceSignals, signals } from '@novi/db';
import { describe, expect, it } from 'vitest';
import { computeSignals, revenueGrowth } from '../src/steps/signals';

describe('revenueGrowth', () => {
  it('compares the two most recent years with revenue', () => {
    expect(
      revenueGrowth({ '2022': { ca: 100, resultat_net: 1 }, '2023': { ca: 120, resultat_net: 2 } }),
    ).toEqual({ percent: 20, years: ['2022', '2023'] });
    expect(
      revenueGrowth({ '2021': { ca: 100, resultat_net: 1 }, '2023': { ca: 50, resultat_net: null } }),
    ).toEqual({ percent: -50, years: ['2021', '2023'] });
    expect(revenueGrowth({ '2023': { ca: 50, resultat_net: null } })).toBeNull();
    expect(
      revenueGrowth({ '2022': { ca: 0, resultat_net: null }, '2023': { ca: 50, resultat_net: null } }),
    ).toBeNull();
    expect(revenueGrowth(null)).toBeNull();
  });
});

describe('computeSignals', () => {
  it('derives recruiting, hiring history, careers page and revenue growth, keeping other signals', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    const now = new Date('2026-09-29T00:00:00Z');
    db.insert(companies)
      .values({
        siren: '000000001',
        name: 'A',
        legalName: 'A',
        nafCode: '62.01Z',
        siretLocal: 'a',
        latitude: 43.7,
        longitude: 7.2,
        careersUrl: 'https://a.example/jobs',
        finances: { '2022': { ca: 100, resultat_net: 1 }, '2023': { ca: 130, resultat_net: 2 } },
      })
      .run();
    db.insert(jobOffers)
      .values([
        { id: '1', title: 'x', siren: '000000001', publishedAt: '2026-09-01T00:00:00Z', isActive: true },
        { id: '2', title: 'y', siren: '000000001', publishedAt: '2026-02-01T00:00:00Z', isActive: false },
        { id: '3', title: 'z', siren: '000000001', publishedAt: '2024-01-01T00:00:00Z', isActive: false },
      ])
      .run();
    replaceSignals(
      db,
      '000000001',
      ['esn_suspected'],
      [{ kind: 'esn_suspected', value: null, evidence: 'régie' }],
    );

    const result = await computeSignals(db, { now });
    expect(result.stats.processed).toBe(1);
    const rows = db
      .select()
      .from(signals)
      .all()
      .map((s) => [s.kind, s.value])
      .sort();
    expect(rows).toEqual([
      ['careers_page_found', 1],
      ['esn_suspected', null],
      ['hired_last_12_months', 2],
      ['recruiting_now', 1],
      ['revenue_growth', 30],
    ]);
    await computeSignals(db, { now });
    expect(db.select().from(signals).all()).toHaveLength(5);
  });
});
