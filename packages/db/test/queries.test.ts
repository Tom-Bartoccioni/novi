import { describe, expect, it } from 'vitest';
import { findAlias, replaceCompanyTech, replaceSignals, saveAlias, upsertCompanyTech } from '../src/queries';
import { companies, companyTech, signals } from '../src/schema';
import { company, createTestDb } from './helpers';

describe('company tech helpers', () => {
  it('upsert keeps the best confidence and replace wipes a source', () => {
    const db = createTestDb();
    db.insert(companies)
      .values(company({ siren: '000000001' }))
      .run();
    upsertCompanyTech(db, '000000001', 'offre', [{ slug: 'react', evidence: 'a', confidence: 0.5 }]);
    upsertCompanyTech(db, '000000001', 'offre', [{ slug: 'react', evidence: 'b', confidence: 0.9 }]);
    upsertCompanyTech(db, '000000001', 'offre', [{ slug: 'react', evidence: 'c', confidence: 0.3 }]);
    const row = db.select().from(companyTech).get();
    expect(row?.confidence).toBe(0.9);
    expect(row?.evidence).toBe('b');
    replaceCompanyTech(db, '000000001', 'site', [{ slug: 'vue', evidence: 's', confidence: 0.7 }]);
    replaceCompanyTech(db, '000000001', 'site', [{ slug: 'nuxt', evidence: 's', confidence: 0.9 }]);
    const slugs = db
      .select()
      .from(companyTech)
      .all()
      .map((r) => `${r.source}:${r.tagSlug}`)
      .sort();
    expect(slugs).toEqual(['offre:react', 'site:nuxt']);
  });
});

describe('signals and aliases', () => {
  it('replaceSignals only touches the given kinds', () => {
    const db = createTestDb();
    db.insert(companies)
      .values(company({ siren: '000000001' }))
      .run();
    replaceSignals(
      db,
      '000000001',
      ['esn_suspected'],
      [{ kind: 'esn_suspected', value: null, evidence: 'régie' }],
    );
    replaceSignals(
      db,
      '000000001',
      ['recruiting_now'],
      [{ kind: 'recruiting_now', value: 2, evidence: null }],
    );
    replaceSignals(
      db,
      '000000001',
      ['recruiting_now'],
      [{ kind: 'recruiting_now', value: 3, evidence: null }],
    );
    const rows = db.select().from(signals).all();
    expect(rows.map((r) => [r.kind, r.value])).toEqual([
      ['esn_suspected', null],
      ['recruiting_now', 3],
    ]);
  });
  it('aliases are looked up by normalized name', () => {
    const db = createTestDb();
    db.insert(companies)
      .values(company({ siren: '000000001' }))
      .run();
    saveAlias(db, 'CLIKEN WEB SAS', '000000001');
    expect(findAlias(db, 'cliken web')).toBe('000000001');
    expect(findAlias(db, 'autre')).toBeNull();
  });
});
