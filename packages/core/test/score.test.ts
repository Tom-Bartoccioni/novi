import { describe, expect, it } from 'vitest';
import { isRecentOffer, scoreCompany } from '../src/score';
import type { ScoreCompany, ScoreProfile } from '../src/types';

const profile: ScoreProfile = {
  skills: ['react', 'typescript', 'postgresql'],
  radiusKm: 30,
  headcountRanges: ['11', '12'],
};

const base: ScoreCompany = { headcountRange: '12', techs: [], activeOffers: [], signals: [] };

describe('scoreCompany', () => {
  it('gives 0 with no match and max distance', () => {
    const r = scoreCompany(profile, { ...base, headcountRange: '53' }, 30);
    expect(r.score).toBe(0);
    expect(r.lines).toEqual([]);
  });
  it('scores tech overlap with best confidence, capped at 4 points of confidence', () => {
    const r = scoreCompany(
      profile,
      {
        ...base,
        headcountRange: null,
        techs: [
          { slug: 'react', confidence: 0.9 },
          { slug: 'typescript', confidence: 0.5 },
          { slug: 'go', confidence: 0.9 },
        ],
      },
      30,
    );
    // (0.9 + 0.5) / 4 * 40 = 14
    expect(r.lines).toContainEqual({ label: '2 technos communes', points: 14 });
    expect(r.score).toBe(14);
  });
  it('scores proximity linearly', () => {
    expect(scoreCompany(profile, { ...base, headcountRange: null }, 0).lines).toContainEqual({
      label: '0 km',
      points: 20,
    });
    expect(scoreCompany(profile, { ...base, headcountRange: null }, 15).lines).toContainEqual({
      label: '15 km',
      points: 10,
    });
  });
  it('scores headcount fit', () => {
    expect(scoreCompany(profile, base, 30).lines).toContainEqual({
      label: 'Taille souhaitée (20 à 49 salariés)',
      points: 15,
    });
  });
  it('scores active offers: 15 if one matches a skill, 8 otherwise', () => {
    expect(
      scoreCompany(profile, { ...base, headcountRange: null, activeOffers: [{ techSlugs: ['react'] }] }, 30)
        .lines,
    ).toContainEqual({
      label: '1 offre active correspondant au profil',
      points: 15,
    });
    expect(
      scoreCompany(
        profile,
        { ...base, headcountRange: null, activeOffers: [{ techSlugs: ['php'] }, { techSlugs: [] }] },
        30,
      ).lines,
    ).toContainEqual({
      label: '2 offres actives',
      points: 8,
    });
  });
  it('scores signals and caps them at 10', () => {
    const r = scoreCompany(
      profile,
      {
        ...base,
        headcountRange: null,
        signals: [
          { kind: 'hired_last_12_months', value: 3 },
          { kind: 'github_active', value: 1 },
          { kind: 'revenue_growth', value: 12 },
        ],
      },
      30,
    );
    expect(r.lines).toContainEqual({ label: 'A recruté sur 12 mois (3 offres)', points: 4 });
    expect(r.lines).toContainEqual({ label: 'GitHub actif', points: 3 });
    expect(r.lines).toContainEqual({ label: 'Chiffre d’affaires en hausse (+12 %)', points: 3 });
    expect(r.score).toBe(10);
  });
  it('penalises suspected ESN and never goes below 0', () => {
    const r = scoreCompany(
      profile,
      { ...base, headcountRange: null, signals: [{ kind: 'esn_suspected', value: null }] },
      30,
    );
    expect(r.lines).toContainEqual({ label: 'ESN suspectée', points: -20 });
    expect(r.score).toBe(0);
  });
  it('rounds the total', () => {
    const r = scoreCompany(profile, { ...base, techs: [{ slug: 'react', confidence: 0.7 }] }, 7);
    // 7 + 15.33 + 15 = 37.33 -> 37
    expect(r.score).toBe(37);
  });
  it('ignores duplicate signal rows of the same kind and negative distances', () => {
    const r = scoreCompany(
      profile,
      {
        ...base,
        headcountRange: null,
        signals: [
          { kind: 'github_active', value: 1 },
          { kind: 'github_active', value: 1 },
          { kind: 'github_active', value: 1 },
        ],
      },
      -5,
    );
    expect(r.lines.filter((l) => l.label === 'GitHub actif')).toHaveLength(1);
    expect(r.lines).toContainEqual({ label: '0 km', points: 20 });
  });
});

describe('recent offers', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  const recent = '2026-10-03T08:00:00Z';
  const old = '2026-09-01T08:00:00Z';

  it('isRecentOffer compares against newOfferDays', () => {
    expect(isRecentOffer(recent, 7, now)).toBe(true);
    expect(isRecentOffer(old, 7, now)).toBe(false);
    expect(isRecentOffer(null, 7, now)).toBe(false);
    expect(isRecentOffer('n/a', 7, now)).toBe(false);
    expect(isRecentOffer(old, 60, now)).toBe(true);
  });
  it('gives 20 points for a matching recent offer', () => {
    const r = scoreCompany(
      { ...profile, newOfferDays: 7 },
      { ...base, headcountRange: null, activeOffers: [{ techSlugs: ['react'], publishedAt: recent }] },
      30,
      now,
    );
    expect(r.lines).toContainEqual({ label: '1 offre récente correspondant au profil', points: 20 });
  });
  it('gives 15 points for a matching but old offer', () => {
    const r = scoreCompany(
      { ...profile, newOfferDays: 7 },
      { ...base, headcountRange: null, activeOffers: [{ techSlugs: ['react'], publishedAt: old }] },
      30,
      now,
    );
    expect(r.lines).toContainEqual({ label: '1 offre active correspondant au profil', points: 15 });
  });
  it('gives 10 points for recent offers without a match, 8 otherwise', () => {
    const recentNoMatch = scoreCompany(
      { ...profile, newOfferDays: 7 },
      {
        ...base,
        headcountRange: null,
        activeOffers: [{ techSlugs: ['php'], publishedAt: recent }, { techSlugs: [] }],
      },
      30,
      now,
    );
    expect(recentNoMatch.lines).toContainEqual({ label: '2 offres actives, dont une récente', points: 10 });
    const oldNoMatch = scoreCompany(
      { ...profile, newOfferDays: 7 },
      { ...base, headcountRange: null, activeOffers: [{ techSlugs: ['php'], publishedAt: old }] },
      30,
      now,
    );
    expect(oldNoMatch.lines).toContainEqual({ label: '1 offre active', points: 8 });
  });
  it('defaults newOfferDays to 7 when the profile omits it', () => {
    const r = scoreCompany(
      profile,
      { ...base, headcountRange: null, activeOffers: [{ techSlugs: ['react'], publishedAt: recent }] },
      30,
      now,
    );
    expect(r.lines[0]?.points).toBe(20);
  });
});
