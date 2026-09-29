import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  monthlyWindows,
  parseContentRange,
  searchResponseSchema,
  toOfferRow,
} from '../src/sources/france-travail';

const payload = searchResponseSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/france-travail-search.json'), 'utf8')),
);

describe('searchResponseSchema', () => {
  it('parses offers with optional employer and coordinates', () => {
    expect(payload.resultats).toHaveLength(3);
    expect(payload.resultats[2]?.entreprise).toBeUndefined();
    expect(payload.resultats[2]?.lieuTravail?.latitude).toBeUndefined();
  });
});

describe('parseContentRange', () => {
  it('reads first, last and total', () => {
    expect(parseContentRange('offres 0-149/1234')).toEqual({ first: 0, last: 149, total: 1234 });
    expect(parseContentRange(null)).toBeNull();
    expect(parseContentRange('offres 0-2/3')).toEqual({ first: 0, last: 2, total: 3 });
  });
});

describe('monthlyWindows', () => {
  it('produces 12 consecutive windows ending now', () => {
    const now = new Date('2026-09-29T12:00:00Z');
    const windows = monthlyWindows(now, 12);
    expect(windows).toHaveLength(12);
    expect(windows[0]?.max).toBe('2026-09-29T12:00:00Z');
    expect(windows[0]?.min).toBe('2026-08-29T12:00:00Z');
    expect(windows[11]?.min).toBe('2025-09-29T12:00:00Z');
    for (let i = 1; i < windows.length; i++) expect(windows[i]?.max).toBe(windows[i - 1]?.min);
  });
});

describe('toOfferRow', () => {
  it('maps fields and picks the origin URL', () => {
    const row = toOfferRow(payload.resultats[0]!, 7);
    expect(row).toMatchObject({
      id: '190ABCD',
      source: 'france_travail',
      employerName: 'CLIKEN WEB',
      title: 'Développeur Full Stack React / Node.js (H/F)',
      url: 'https://candidat.francetravail.fr/offres/recherche/detail/190ABCD',
      contractType: 'CDI',
      publishedAt: '2026-09-01T08:12:00.000Z',
      latitude: 43.6197,
      longitude: 7.0373,
      city: 'VALBONNE',
      isActive: true,
      lastSeenRunId: 7,
    });
  });
  it('handles missing employer and coordinates', () => {
    const row = toOfferRow(payload.resultats[2]!, 7);
    expect(row.employerName).toBeNull();
    expect(row.latitude).toBeNull();
    expect(row.city).toBe('ANTIBES');
  });
});
