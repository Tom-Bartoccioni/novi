import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { companies, companyTech, crawlRuns, createDb, jobOffers, migrateAndSeed } from '@novi/db';
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

  it('does not expire anything on a limited run', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    await ingestOffres(db, { departement: '06', iterate: iterate(payload.resultats) });
    for (let i = 0; i < 3; i++) {
      await ingestOffres(db, { departement: '06', limit: 1, iterate: iterate(payload.resultats) });
    }
    const offers = db.select().from(jobOffers).all();
    expect(offers).toHaveLength(3);
    expect(offers.every((o) => o.isActive)).toBe(true);
  });

  it('ignores failed runs when counting', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    await ingestOffres(db, { departement: '06', iterate: iterate(payload.resultats) });
    // Deux runs échoués (erreur fatale, sans siren : ex. authentification) journalisés entre-temps.
    for (let i = 0; i < 2; i++) {
      db.insert(crawlRuns)
        .values({
          command: 'ingest offres',
          args: { departement: '06', limit: null },
          finishedAt: new Date().toISOString(),
          stats: { processed: 0, created: 0, updated: 0, errors: 1 },
          errors: [{ message: 'auth' }],
        })
        .run();
    }
    // Un run complet avec seulement une erreur par offre (siren présent) compte comme réussi.
    db.insert(crawlRuns)
      .values({
        command: 'ingest offres',
        args: { departement: '06', limit: null },
        finishedAt: new Date().toISOString(),
        stats: { processed: 1, created: 0, updated: 0, errors: 1 },
        errors: [{ siren: 'X1', message: 'offre invalide' }],
      })
      .run();
    const twoOnly = payload.resultats.slice(0, 2);
    const isActive = () =>
      db
        .select()
        .from(jobOffers)
        .all()
        .find((o) => o.id === '190IJKL')?.isActive;
    // Runs réussis précédents : le premier run et le run « offre invalide » ; les deux runs
    // échoués sont ignorés. Seuil = premier run : 190IJKL, vue à ce run, reste active.
    await ingestOffres(db, { departement: '06', iterate: iterate(twoOnly) });
    expect(isActive()).toBe(true);
    // Seuil = run « offre invalide » : 190IJKL expire. Si ce run n'était pas compté, le seuil
    // resterait le premier run et l'offre resterait active.
    await ingestOffres(db, { departement: '06', iterate: iterate(twoOnly) });
    expect(isActive()).toBe(false);
  });
});
