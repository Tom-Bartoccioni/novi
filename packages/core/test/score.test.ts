import { describe, expect, it } from 'vitest';
import { scoreCompany } from '../src/score';
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
});
