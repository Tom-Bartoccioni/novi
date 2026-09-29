import { companyStatus, getDefaultProfile, profiles } from '@novi/db';
import { describe, expect, it } from 'vitest';
import {
  availableTechs,
  getCompanyDetail,
  listCompanies,
  listUnmatchedOffers,
  parseFilters,
  pipelineOverview,
  searchCompaniesByName,
} from '@/lib/data';
import { seededDb } from './helpers';

describe('parseFilters', () => {
  it('reads arrays, booleans and sort from search params', () => {
    expect(
      parseFilters({
        techs: 'react,php',
        headcount: '12',
        recruiting: '1',
        status: 'interested',
        sort: 'distance',
        q: 'nice',
      }),
    ).toEqual({
      techs: ['react', 'php'],
      headcount: ['12'],
      recruiting: true,
      status: 'interested',
      sort: 'distance',
      q: 'nice',
    });
    expect(parseFilters({})).toEqual({
      techs: [],
      headcount: [],
      recruiting: false,
      status: null,
      sort: 'score',
      q: '',
    });
    expect(parseFilters({ sort: 'bogus' }).sort).toBe('score');
  });
});

describe('listCompanies', () => {
  it('returns companies within the radius, scored and sorted by score', () => {
    const db = seededDb();
    db.update(profiles)
      .set({ skills: ['react', 'typescript'] })
      .run();
    const profile = getDefaultProfile(db);
    const rows = listCompanies(db, profile, parseFilters({}));
    expect(rows.map((r) => r.name)).toEqual(['Cliken Web', 'Nice Tech Studio']);
    const cliken = rows[0]!;
    expect(cliken.score).toBeGreaterThan(rows[1]!.score);
    expect(cliken.recruiting).toBe(true);
    expect(cliken.topTechs.map((t) => t.slug)).toEqual(['react', 'postgresql']);
    expect(cliken.topTechs[0]?.confidence).toBe(0.8);
    expect(cliken.status).toBe('to_review');
    expect(cliken.distanceKm).toBeGreaterThan(18);
  });
  it('filters by tech, headcount, recruiting, status and query; sorts by distance', () => {
    const db = seededDb();
    const profile = getDefaultProfile(db);
    expect(listCompanies(db, profile, parseFilters({ techs: 'php' })).map((r) => r.name)).toEqual([
      'Nice Tech Studio',
    ]);
    expect(listCompanies(db, profile, parseFilters({ headcount: '12' })).map((r) => r.name)).toEqual([
      'Cliken Web',
    ]);
    expect(listCompanies(db, profile, parseFilters({ recruiting: '1' })).map((r) => r.name)).toEqual([
      'Cliken Web',
    ]);
    expect(listCompanies(db, profile, parseFilters({ q: 'studio' })).map((r) => r.name)).toEqual([
      'Nice Tech Studio',
    ]);
    expect(listCompanies(db, profile, parseFilters({ sort: 'distance' })).map((r) => r.name)).toEqual([
      'Nice Tech Studio',
      'Cliken Web',
    ]);
    db.insert(companyStatus)
      .values({ profileId: profile.id, siren: '000000002', status: 'interested' })
      .run();
    expect(listCompanies(db, profile, parseFilters({ status: 'interested' })).map((r) => r.name)).toEqual([
      'Nice Tech Studio',
    ]);
    expect(listCompanies(db, profile, parseFilters({ status: 'to_review' })).map((r) => r.name)).toEqual([
      'Cliken Web',
    ]);
  });
  it('exposes the tech tags available for filtering, with company counts', () => {
    const db = seededDb();
    expect(
      availableTechs(db)
        .map((t) => [t.slug, t.count])
        .sort(),
    ).toEqual([
      ['php', 1],
      ['postgresql', 1],
      ['react', 1],
    ]);
  });
});

describe('getCompanyDetail', () => {
  it('groups techs by category with sources and evidence, lists active offers, signals and score lines', () => {
    const db = seededDb();
    db.update(profiles)
      .set({ skills: ['react'] })
      .run();
    const profile = getDefaultProfile(db);
    const detail = getCompanyDetail(db, profile, '000000001');
    expect(detail).not.toBeNull();
    const d = detail!;
    expect(d.company.name).toBe('Cliken Web');
    expect(d.distanceKm).toBeGreaterThan(18);
    const framework = d.techGroups.find((g) => g.category === 'framework');
    expect(framework?.techs[0]).toMatchObject({ slug: 'react', label: 'React', inProfile: true });
    expect(framework?.techs[0]?.sources.map((s) => s.source).sort()).toEqual(['offre', 'site']);
    expect(d.activeOffers.map((o) => o.id)).toEqual(['A']);
    expect(d.signals.map((s) => s.kind)).toEqual(['recruiting_now']);
    expect(d.score.lines.map((l) => l.label)).toEqual(
      expect.arrayContaining([
        '1 techno commune',
        'Taille souhaitée (20 à 49 salariés)',
        '1 offre active correspondant au profil',
      ]),
    );
    expect(d.status).toBe('to_review');
    expect(d.notes).toBe('');
    expect(d.links.linkedinSearch).toContain('Cliken');
  });
  it('returns null for an unknown siren', () => {
    const db = seededDb();
    expect(getCompanyDetail(db, getDefaultProfile(db), '999')).toBeNull();
  });
});

describe('unmatched offers, search, overview', () => {
  it('groups unmatched offers by employer', () => {
    const db = seededDb();
    const groups = listUnmatchedOffers(db);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ employerName: 'INCONNU SARL', count: 2 });
    expect(groups[0]?.offers.map((o) => o.id).sort()).toEqual(['B', 'C']);
  });
  it('searches companies by name', () => {
    const db = seededDb();
    expect(searchCompaniesByName(db, 'tech').map((c) => c.siren)).toEqual(['000000002']);
    expect(searchCompaniesByName(db, '')).toEqual([]);
  });
  it('summarises the pipeline state', () => {
    const db = seededDb();
    const o = pipelineOverview(db);
    expect(o.counts).toEqual({
      companies: 3,
      withWebsite: 1,
      crawled: 0,
      techDetections: 4,
      activeOffers: 3,
      unmatchedOffers: 2,
    });
    expect(o.runs).toEqual([]);
  });
});
