import {
  companies,
  companyTech,
  createDb,
  type Db,
  jobOffers,
  migrateAndSeed,
  replaceSignals,
} from '@novi/db';

export function seededDb(): Db {
  const db = createDb(':memory:');
  migrateAndSeed(db);
  db.insert(companies)
    .values([
      {
        siren: '000000001',
        name: 'Cliken Web',
        legalName: 'CLIKEN WEB PRO',
        nafCode: '62.01Z',
        nafLabel: 'Programmation informatique',
        headcountRange: '12',
        siretLocal: 'a',
        latitude: 43.6197,
        longitude: 7.0373,
        city: 'VALBONNE',
        website: 'https://www.cliken-web.com',
        careersUrl: 'https://www.cliken-web.com/jobs',
      },
      {
        siren: '000000002',
        name: 'Nice Tech Studio',
        legalName: 'NICE TECH STUDIO',
        nafCode: '62.02A',
        headcountRange: '03',
        siretLocal: 'b',
        latitude: 43.7102,
        longitude: 7.262,
        city: 'NICE',
      },
      {
        siren: '000000003',
        name: 'Marseille Soft',
        legalName: 'MARSEILLE SOFT',
        nafCode: '62.01Z',
        headcountRange: '12',
        siretLocal: 'c',
        latitude: 43.2965,
        longitude: 5.3698,
        city: 'MARSEILLE',
      },
    ])
    .run();
  db.insert(companyTech)
    .values([
      { siren: '000000001', tagSlug: 'react', source: 'site', confidence: 0.7, evidence: 'Stack : React' },
      { siren: '000000001', tagSlug: 'react', source: 'offre', confidence: 0.8, evidence: 'Offre React' },
      { siren: '000000001', tagSlug: 'postgresql', source: 'site', confidence: 0.5, evidence: 'PostgreSQL' },
      {
        siren: '000000002',
        tagSlug: 'php',
        source: 'site',
        confidence: 0.9,
        evidence: 'empreinte : x-powered-by: php',
      },
    ])
    .run();
  db.insert(jobOffers)
    .values([
      {
        id: 'A',
        title: 'Dev React',
        description: 'React et TypeScript',
        siren: '000000001',
        employerName: 'CLIKEN WEB',
        isActive: true,
        publishedAt: '2026-09-01T00:00:00Z',
      },
      {
        id: 'B',
        title: 'Dev PHP',
        description: 'Symfony',
        siren: null,
        employerName: 'INCONNU SARL',
        isActive: true,
        publishedAt: '2026-09-02T00:00:00Z',
        latitude: 43.7,
        longitude: 7.26,
      },
      {
        id: 'C',
        title: 'Dev Go',
        description: 'Go',
        siren: null,
        employerName: 'INCONNU SARL',
        isActive: true,
        publishedAt: '2026-09-03T00:00:00Z',
      },
    ])
    .run();
  replaceSignals(
    db,
    '000000001',
    ['recruiting_now'],
    [{ kind: 'recruiting_now', value: 1, evidence: '1 offre active' }],
  );
  replaceSignals(
    db,
    '000000002',
    ['esn_suspected'],
    [{ kind: 'esn_suspected', value: null, evidence: 'régie' }],
  );
  return db;
}
