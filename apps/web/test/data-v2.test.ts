import { crawlRuns, getDefaultProfile, jobOffers, offerViews, profiles } from '@novi/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  countUnseenOffersInRadius,
  getCompanyDetail,
  listCompanies,
  parseFilters,
  pipelineOverview,
} from '@/lib/data';
import { seededDb } from './helpers';

const NOW = new Date('2026-10-06T12:00:00Z');
const RECENT = '2026-10-05T09:00:00Z';
const OLD = '2026-08-01T00:00:00Z';

/** Cliken Web recrute avec une offre récente (D) ; Nice Tech Studio recrute avec une seule offre ancienne (E). */
function withRecentOffer() {
  const db = seededDb();
  db.insert(jobOffers)
    .values([
      {
        id: 'D',
        title: 'Dev TypeScript',
        description: 'TypeScript',
        siren: '000000001',
        publishedAt: RECENT,
      },
      { id: 'E', title: 'Dev PHP', description: 'PHP', siren: '000000002', publishedAt: OLD },
    ])
    .run();
  const profile = getDefaultProfile(db);
  db.update(profiles)
    .set({ skills: ['typescript'] })
    .where(eq(profiles.id, profile.id))
    .run();
  return { db, profile: getDefaultProfile(db) };
}

describe('parseFilters', () => {
  it('reads the nouvelles flag', () => {
    expect(parseFilters({ nouvelles: '1' }).nouvelles).toBe(true);
    expect(parseFilters({}).nouvelles).toBe(false);
  });
});

describe('listCompanies V2', () => {
  it('counts recent and unseen offers per company', () => {
    const { db, profile } = withRecentOffer();
    const items = listCompanies(db, profile, parseFilters({}), NOW);
    const cliken = items.find((c) => c.siren === '000000001');
    expect(cliken).toMatchObject({ recentOffers: 1, unseenOffers: 2, recruiting: true });
    expect(items.find((c) => c.siren === '000000002')).toMatchObject({
      recentOffers: 0,
      unseenOffers: 1,
      recruiting: true,
    });
  });
  it('filters on nouvelles, unlike recruiting which keeps companies with only old offers', () => {
    const { db, profile } = withRecentOffer();
    const nouvelles = listCompanies(db, profile, parseFilters({ nouvelles: '1' }), NOW);
    expect(nouvelles.map((c) => c.siren)).toEqual(['000000001']);
    const recruiting = listCompanies(db, profile, parseFilters({ recruiting: '1' }), NOW);
    expect(recruiting.map((c) => c.siren).sort()).toEqual(['000000001', '000000002']);
  });
  it('uses the profile window in the score', () => {
    const { db, profile } = withRecentOffer();
    const recent = listCompanies(db, profile, parseFilters({}), NOW).find((c) => c.siren === '000000001');
    db.update(profiles).set({ newOfferDays: 0 }).where(eq(profiles.id, profile.id)).run();
    const noWindow = listCompanies(db, getDefaultProfile(db), parseFilters({}), NOW).find(
      (c) => c.siren === '000000001',
    );
    expect((recent?.score ?? 0) - (noWindow?.score ?? 0)).toBe(5);
  });
  it('decrements unseen once the offers were viewed', () => {
    const { db, profile } = withRecentOffer();
    db.insert(offerViews).values({ profileId: profile.id, offerId: 'A' }).run();
    const cliken = listCompanies(db, profile, parseFilters({}), NOW).find((c) => c.siren === '000000001');
    expect(cliken?.unseenOffers).toBe(1);
  });
});

describe('getCompanyDetail V2', () => {
  it('flags recent and unseen offers and records the views when asked', () => {
    const { db, profile } = withRecentOffer();
    const first = getCompanyDetail(db, profile, '000000001', { markSeen: true, now: NOW });
    expect(first?.activeOffers.map((o) => [o.id, o.isRecent, o.unseen])).toEqual([
      ['D', true, true],
      ['A', false, true],
    ]);
    const second = getCompanyDetail(db, profile, '000000001', { markSeen: true, now: NOW });
    expect(second?.activeOffers.every((o) => o.unseen === false)).toBe(true);
    expect(db.select().from(offerViews).all()).toHaveLength(2);
  });
  it('does not record views by default', () => {
    const { db, profile } = withRecentOffer();
    getCompanyDetail(db, profile, '000000001');
    expect(db.select().from(offerViews).all()).toHaveLength(0);
  });
  it('reads unseen from the recorded views without markSeen', () => {
    const { db, profile } = withRecentOffer();
    const unseenOf = () =>
      Object.fromEntries(
        (getCompanyDetail(db, profile, '000000001', { now: NOW })?.activeOffers ?? []).map((o) => [
          o.id,
          o.unseen,
        ]),
      );
    expect(unseenOf()).toEqual({ D: true, A: true });
    db.insert(offerViews).values({ profileId: profile.id, offerId: 'A' }).run();
    expect(unseenOf()).toEqual({ D: true, A: false });
  });
  it('returns the cover letters of the company', () => {
    const { db, profile } = withRecentOffer();
    expect(getCompanyDetail(db, profile, '000000001')?.letters).toEqual([]);
  });
});

describe('countUnseenOffersInRadius', () => {
  it('counts active linked offers of companies in radius not yet viewed', () => {
    const { db, profile } = withRecentOffer();
    expect(countUnseenOffersInRadius(db, profile)).toBe(3);
    db.insert(offerViews).values({ profileId: profile.id, offerId: 'D' }).run();
    expect(countUnseenOffersInRadius(db, profile)).toBe(2);
  });
});

describe('pipelineOverview V2', () => {
  it('exposes the last finished refresh run and whether it is stale', () => {
    const db = seededDb();
    expect(pipelineOverview(db, NOW).lastRefresh).toBeNull();
    db.insert(crawlRuns)
      .values({
        command: 'refresh',
        startedAt: '2026-10-06T08:00:00.000Z',
        finishedAt: '2026-10-06T08:01:00.000Z',
        stats: { processed: 3, created: 0, updated: 0, errors: 0, newOffers: 3, linked: 1 },
      })
      .run();
    const fresh = pipelineOverview(db, NOW);
    expect(fresh.lastRefresh?.stats).toMatchObject({ newOffers: 3 });
    expect(fresh.refreshStale).toBe(false);
    expect(pipelineOverview(db, new Date('2026-10-07T12:00:00Z')).refreshStale).toBe(true);
  });
});
