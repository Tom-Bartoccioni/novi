import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { companies, companyTech, createDb, jobOffers, migrateAndSeed } from '@novi/db';
import { describe, expect, it } from 'vitest';
import { type Offer, searchResponseSchema } from '../src/sources/france-travail';
import { ingestOffres } from '../src/steps/ingest-offres';

const payload = searchResponseSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/france-travail-search.json'), 'utf8')),
);

function iterate(offers: Offer[]) {
  return async function* () {
    for (const o of offers) yield o;
  };
}

describe('ingestOffres', () => {
  it('upserts offers, detects techs for already-matched offers, expires unseen offers after 3 runs', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    db.insert(companies)
      .values({
        siren: '852196609',
        name: 'Cliken Web',
        legalName: 'CLIKEN WEB PRO',
        nafCode: '62.01Z',
        siretLocal: '85219660900048',
        latitude: 43.6197,
        longitude: 7.0373,
      })
      .run();
    // L'offre 190ABCD est déjà rattachée (par un run précédent de match).
    await ingestOffres(db, { departement: '06', iterate: iterate(payload.resultats) });
    db.update(jobOffers).set({ siren: '852196609' }).run();

    await ingestOffres(db, { departement: '06', iterate: iterate(payload.resultats) });
    const techs = db
      .select()
      .from(companyTech)
      .all()
      .map((t) => t.tagSlug)
      .sort();
    expect(techs).toEqual(expect.arrayContaining(['react', 'typescript', 'nodejs', 'postgresql', 'aws']));

    // Trois runs sans l'offre 190IJKL : elle expire.
    const twoOnly = payload.resultats.slice(0, 2);
    await ingestOffres(db, { departement: '06', iterate: iterate(twoOnly) });
    await ingestOffres(db, { departement: '06', iterate: iterate(twoOnly) });
    expect(
      db
        .select()
        .from(jobOffers)
        .all()
        .find((o) => o.id === '190IJKL')?.isActive,
    ).toBe(true);
    await ingestOffres(db, { departement: '06', iterate: iterate(twoOnly) });
    expect(
      db
        .select()
        .from(jobOffers)
        .all()
        .find((o) => o.id === '190IJKL')?.isActive,
    ).toBe(false);
    expect(
      db
        .select()
        .from(jobOffers)
        .all()
        .find((o) => o.id === '190ABCD')?.isActive,
    ).toBe(true);
  });
});
