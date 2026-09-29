import { companies, companyStatus, employerAliases, getDefaultProfile, jobOffers } from '@novi/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { applyLinkEmployer, applyNotes, applyProfile, applyStatus, applyWebsite } from '@/lib/mutations';
import { seededDb } from './helpers';

describe('status and notes', () => {
  it('upserts the status row for the profile', () => {
    const db = seededDb();
    const profile = getDefaultProfile(db);
    applyStatus(db, profile.id, '000000001', 'interested');
    applyStatus(db, profile.id, '000000001', 'contacted');
    applyNotes(db, profile.id, '000000001', 'Appeler lundi');
    const row = db.select().from(companyStatus).where(eq(companyStatus.siren, '000000001')).get();
    expect(row).toMatchObject({ status: 'contacted', notes: 'Appeler lundi' });
  });
  it('rejects an unknown status', () => {
    const db = seededDb();
    expect(() => applyStatus(db, getDefaultProfile(db).id, '000000001', 'bogus')).toThrow(/statut/i);
  });
});

describe('website', () => {
  it('stores a normalized manual website', () => {
    const db = seededDb();
    applyWebsite(db, '000000002', 'nicetech.fr');
    expect(db.select().from(companies).where(eq(companies.siren, '000000002')).get()).toMatchObject({
      website: 'https://nicetech.fr',
      websiteSource: 'manuel',
      websiteConfidence: 1,
    });
  });
  it('rejects garbage', () => {
    const db = seededDb();
    expect(() => applyWebsite(db, '000000002', 'pas une url')).toThrow(/URL/);
  });
});

describe('link employer', () => {
  it('links all unmatched offers of the employer, saves the alias and writes techs', () => {
    const db = seededDb();
    const result = applyLinkEmployer(db, 'INCONNU SARL', '000000002');
    expect(result.linked).toBe(2);
    expect(
      db
        .select()
        .from(jobOffers)
        .where(eq(jobOffers.siren, '000000002'))
        .all()
        .map((o) => o.id)
        .sort(),
    ).toEqual(['B', 'C']);
    expect(db.select().from(employerAliases).get()?.employerNameNormalized).toBe('inconnu');
  });
});

describe('profile', () => {
  it('updates radius, skills and headcount ranges, keeping unknown skills out', () => {
    const db = seededDb();
    const profile = getDefaultProfile(db);
    applyProfile(db, profile.id, {
      homeLabel: 'Antibes',
      homeLatitude: 43.58,
      homeLongitude: 7.12,
      radiusKm: 20,
      skills: ['react', 'inexistant'],
      headcountRanges: ['11', '12'],
    });
    expect(getDefaultProfile(db)).toMatchObject({
      homeLabel: 'Antibes',
      radiusKm: 20,
      skills: ['react'],
      headcountRanges: ['11', '12'],
    });
  });
  it('rejects a radius outside 1..200', () => {
    const db = seededDb();
    const profile = getDefaultProfile(db);
    expect(() =>
      applyProfile(db, profile.id, {
        homeLabel: 'x',
        homeLatitude: 0,
        homeLongitude: 0,
        radiusKm: 0,
        skills: [],
        headcountRanges: [],
      }),
    ).toThrow(/rayon/i);
  });
});
