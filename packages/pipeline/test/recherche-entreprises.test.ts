import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickLocalEstablishment, searchPageSchema, toCompanyRow } from '../src/sources/recherche-entreprises';

const page = searchPageSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/recherche-entreprises-page.json'), 'utf8')),
);

describe('searchPageSchema', () => {
  it('parses the real API payload', () => {
    expect(page.results.length).toBeGreaterThan(0);
    expect(page.total_results).toBeGreaterThan(0);
    expect(page.results[0]?.siren).toMatch(/^\d{9}$/);
  });
});

describe('pickLocalEstablishment', () => {
  it('prefers the head office when it is in the department', () => {
    const inZone = page.results.find((r) => r.siege.departement === '06');
    if (!inZone) return;
    const picked = pickLocalEstablishment(inZone, '06');
    expect(picked?.siret).toBe(inZone.siege.siret);
    expect(picked?.headquartersInZone).toBe(true);
  });
  it('falls back to a matching establishment when the head office is elsewhere', () => {
    const outside = page.results.find((r) => r.siege.departement !== '06');
    if (!outside) return;
    const picked = pickLocalEstablishment(outside, '06');
    expect(picked?.headquartersInZone).toBe(false);
    expect(picked?.siret.startsWith(outside.siren)).toBe(true);
    expect(picked?.latitude).toBeGreaterThan(43);
  });
  it('returns null when nothing is in the department', () => {
    const first = page.results[0];
    if (!first) throw new Error('fixture vide');
    expect(pickLocalEstablishment(first, '99')).toBeNull();
  });
});

describe('toCompanyRow', () => {
  it('maps a result to a companies row', () => {
    const first = page.results[0];
    if (!first) throw new Error('fixture vide');
    const row = toCompanyRow(first, '06', { '62.01Z': 'Programmation informatique' });
    expect(row).not.toBeNull();
    expect(row?.siren).toBe(first.siren);
    expect(row?.legalName).toBe(first.nom_raison_sociale);
    expect(row?.nafLabel).toBe('Programmation informatique');
    expect(typeof row?.latitude).toBe('number');
    expect(row?.tradeNames).toBeInstanceOf(Array);
  });
});
