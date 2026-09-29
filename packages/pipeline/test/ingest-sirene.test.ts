import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { companies, createDb, migrateAndSeed } from '@novi/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { searchPageSchema } from '../src/sources/recherche-entreprises';
import { ingestSirene } from '../src/steps/ingest-sirene';

const page = searchPageSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/recherche-entreprises-page.json'), 'utf8')),
);

async function* fakeIterate() {
  for (const r of page.results) yield r;
}

describe('ingestSirene', () => {
  it('upserts companies from the iterator and is idempotent', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    const first = await ingestSirene(db, { departement: '06', iterate: () => fakeIterate() });
    const count = db.select().from(companies).all().length;
    expect(count).toBeGreaterThan(0);
    expect(first.stats.created).toBe(count);
    const second = await ingestSirene(db, { departement: '06', iterate: () => fakeIterate() });
    expect(second.stats.created).toBe(0);
    expect(second.stats.updated).toBe(count);
    expect(db.select().from(companies).all().length).toBe(count);
  });
  it('respects --limit', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    await ingestSirene(db, { departement: '06', limit: 1, iterate: () => fakeIterate() });
    expect(db.select().from(companies).all().length).toBe(1);
  });
  it('counts results without an active local establishment as skipped', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    const first = page.results[0];
    if (!first) throw new Error('fixture vide');
    // Siège hors 06 et aucun établissement actif dans le 06 : rien à retenir.
    const orphan = {
      ...first,
      siren: '000000000',
      matching_etablissements: first.matching_etablissements.filter((e) => e.etat_administratif !== 'A'),
    };
    async function* withOrphan() {
      yield orphan;
      for (const r of page.results) yield r;
    }
    const result = await ingestSirene(db, { departement: '06', iterate: () => withOrphan() });
    expect(result.stats.skipped).toBe(1);
    expect(result.stats.created).toBe(page.results.length);
    expect(db.select().from(companies).where(eq(companies.siren, orphan.siren)).all()).toEqual([]);
  });
  it('counts why results were skipped: no local establishment vs no coordinates', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    const first = page.results[0];
    if (!first) throw new Error('fixture vide');
    const noLocal = {
      ...first,
      siren: '000000000',
      matching_etablissements: first.matching_etablissements.filter((e) => e.etat_administratif !== 'A'),
    };
    const noCoords = {
      ...first,
      siren: '000000001',
      siege: { ...first.siege, departement: '06', code_postal: '06000', latitude: null, longitude: null },
      matching_etablissements: first.matching_etablissements.map((e) => ({
        ...e,
        latitude: null,
        longitude: null,
      })),
    };
    async function* withSkipped() {
      yield noLocal;
      yield noCoords;
      for (const r of page.results) yield r;
    }
    const result = await ingestSirene(db, { departement: '06', iterate: () => withSkipped() });
    expect(result.stats).toMatchObject({ skipped: 2, skippedNoLocal: 1, skippedNoCoords: 1 });
    expect(result.stats.created).toBe(page.results.length);
  });
});
