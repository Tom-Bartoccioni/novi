import { describe, expect, it } from 'vitest';
import { companies, profiles, techTags } from '../src/schema';
import { createTestDb } from './helpers';

describe('migrations and seed', () => {
  it('creates tables, seeds tech tags and a default profile', () => {
    const db = createTestDb();
    expect(db.select().from(techTags).all().length).toBeGreaterThan(100);
    const profile = db.select().from(profiles).get();
    expect(profile?.homeLabel).toBe('Nice');
    expect(profile?.radiusKm).toBe(30);
    expect(db.select().from(companies).all()).toEqual([]);
  });
});
