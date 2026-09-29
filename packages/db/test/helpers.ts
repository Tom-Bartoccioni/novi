import { createDb, type Db, migrateAndSeed } from '../src';
import type { NewCompany } from '../src/schema';

export function createTestDb(): Db {
  const db = createDb(':memory:');
  migrateAndSeed(db);
  return db;
}

export function company(overrides: Partial<NewCompany> & Pick<NewCompany, 'siren'>): NewCompany {
  return {
    name: `Entreprise ${overrides.siren}`,
    legalName: `ENTREPRISE ${overrides.siren}`,
    nafCode: '62.01Z',
    siretLocal: `${overrides.siren}00010`,
    latitude: 43.7102,
    longitude: 7.262,
    ...overrides,
  };
}
