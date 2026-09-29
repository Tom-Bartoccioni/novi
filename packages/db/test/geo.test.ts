import { describe, expect, it } from 'vitest';
import { companiesWithinRadius } from '../src/geo';
import { companies } from '../src/schema';
import { company, createTestDb } from './helpers';

describe('companiesWithinRadius', () => {
  it('returns companies inside the radius sorted by distance', () => {
    const db = createTestDb();
    db.insert(companies)
      .values([
        company({ siren: '000000001', name: 'Nice centre', latitude: 43.7102, longitude: 7.262 }),
        company({ siren: '000000002', name: 'Sophia', latitude: 43.6161, longitude: 7.0553 }),
        company({ siren: '000000003', name: 'Marseille', latitude: 43.2965, longitude: 5.3698 }),
      ])
      .run();
    const rows = companiesWithinRadius(db, { latitude: 43.7102, longitude: 7.262 }, 30);
    expect(rows.map((r) => r.name)).toEqual(['Nice centre', 'Sophia']);
    expect(rows[0]?.distanceKm).toBe(0);
    expect(rows[1]?.distanceKm).toBeGreaterThan(18);
    expect(rows[1]?.distanceKm).toBeLessThan(21);
  });
});
