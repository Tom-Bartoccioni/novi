import { companies, companyTech, createDb, jobOffers, migrateAndSeed, saveAlias } from '@novi/db';
import { describe, expect, it } from 'vitest';
import { findCompanyForOffer, matchOffres } from '../src/steps/match-offres';

function setup() {
  const db = createDb(':memory:');
  migrateAndSeed(db);
  db.insert(companies)
    .values([
      {
        siren: '000000001',
        name: 'Cliken Web',
        legalName: 'CLIKEN WEB PRO',
        tradeNames: ['CLIKEN WEB'],
        nafCode: '62.01Z',
        siretLocal: '00000000100010',
        latitude: 43.6197,
        longitude: 7.0373,
      },
      {
        siren: '000000002',
        name: 'Nice Tech Studio',
        legalName: 'NICE TECH STUDIO',
        nafCode: '62.01Z',
        siretLocal: '00000000200010',
        latitude: 43.7102,
        longitude: 7.262,
      },
      {
        siren: '000000003',
        name: 'Studio Nice Tech',
        legalName: 'STUDIO NICE TECH',
        nafCode: '62.01Z',
        siretLocal: '00000000300010',
        latitude: 43.55,
        longitude: 7.01,
      },
    ])
    .run();
  return db;
}

describe('findCompanyForOffer', () => {
  it('matches on legal name ignoring legal form, within 15 km', () => {
    const db = setup();
    expect(
      findCompanyForOffer(db, { employerName: 'SAS CLIKEN WEB PRO', latitude: 43.62, longitude: 7.04 }),
    ).toBe('000000001');
  });
  it('matches on trade name', () => {
    const db = setup();
    expect(findCompanyForOffer(db, { employerName: 'Cliken Web', latitude: 43.62, longitude: 7.04 })).toBe(
      '000000001',
    );
  });
  it('rejects a name match that is too far away', () => {
    const db = setup();
    expect(
      findCompanyForOffer(db, { employerName: 'Cliken Web', latitude: 43.2965, longitude: 5.3698 }),
    ).toBeNull();
  });
  it('uses fuzzy matching above 0.9 and prefers the closest candidate', () => {
    const db = setup();
    expect(
      findCompanyForOffer(db, { employerName: 'NICE TECH STUDIOS', latitude: 43.71, longitude: 7.26 }),
    ).toBe('000000002');
  });
  it('returns null without coordinates unless the name is exact', () => {
    const db = setup();
    expect(findCompanyForOffer(db, { employerName: 'Cliken Web', latitude: null, longitude: null })).toBe(
      '000000001',
    );
    expect(
      findCompanyForOffer(db, { employerName: 'NICE TECH STUDIOS', latitude: null, longitude: null }),
    ).toBeNull();
  });
  it('aliases win', () => {
    const db = setup();
    saveAlias(db, 'Totally Different Name', '000000003');
    expect(
      findCompanyForOffer(db, { employerName: 'totally different name', latitude: null, longitude: null }),
    ).toBe('000000003');
  });
});

describe('matchOffres', () => {
  it('links offers and writes their techs', async () => {
    const db = setup();
    db.insert(jobOffers)
      .values([
        {
          id: 'A',
          title: 'Dev React',
          description: 'React et TypeScript.',
          employerName: 'CLIKEN WEB',
          latitude: 43.62,
          longitude: 7.04,
        },
        {
          id: 'B',
          title: 'Dev',
          description: 'Rien',
          employerName: 'INCONNU',
          latitude: 43.62,
          longitude: 7.04,
        },
      ])
      .run();
    const result = await matchOffres(db, {});
    expect(result.stats).toMatchObject({ processed: 2, matched: 1 });
    expect(
      db
        .select()
        .from(jobOffers)
        .all()
        .find((o) => o.id === 'A')?.siren,
    ).toBe('000000001');
    expect(
      db
        .select()
        .from(jobOffers)
        .all()
        .find((o) => o.id === 'B')?.siren,
    ).toBeNull();
    expect(
      db
        .select()
        .from(companyTech)
        .all()
        .map((t) => t.tagSlug)
        .sort(),
    ).toEqual(['react', 'typescript']);
  });
});
