import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { companies, createDb, migrateAndSeed } from '@novi/db';
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
});
