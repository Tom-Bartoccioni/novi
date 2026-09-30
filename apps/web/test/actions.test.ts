import {
  companies,
  companyStatus,
  companyTech,
  employerAliases,
  getDefaultProfile,
  jobOffers,
} from '@novi/db';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  applyLinkEmployer,
  applyNotes,
  applyProfile,
  applyStatus,
  applyWebsite,
  normalizeUrl,
} from '@/lib/mutations';
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
  it('rejects a status for an unknown company', () => {
    const db = seededDb();
    expect(() => applyStatus(db, getDefaultProfile(db).id, '999', 'interested')).toThrow(
      'Entreprise inconnue : 999',
    );
  });
  it('rejects notes for an unknown company', () => {
    const db = seededDb();
    expect(() => applyNotes(db, getDefaultProfile(db).id, '999', 'x')).toThrow('Entreprise inconnue : 999');
  });
});

describe('website', () => {
  it('stores a normalized manual website and returns it', () => {
    const db = seededDb();
    expect(applyWebsite(db, '000000002', 'nicetech.fr')).toBe('https://nicetech.fr');
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
  it('rejects an unknown company', () => {
    const db = seededDb();
    expect(() => applyWebsite(db, '999', 'x.fr')).toThrow('Entreprise inconnue : 999');
  });
  it('strips credentials and hash but keeps the query', () => {
    expect(normalizeUrl('https://user:pw@exemple.fr/jobs?lang=fr#top')).toBe(
      'https://exemple.fr/jobs?lang=fr',
    );
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
    // Offre B (« Dev PHP / Symfony ») donne php et symfony ; offre C (« Dev Go / Go ») ne donne rien,
    // le tag go exigeant un contexte pour éviter les faux positifs.
    const offerTechs = db
      .select({ slug: companyTech.tagSlug })
      .from(companyTech)
      .where(and(eq(companyTech.siren, '000000002'), eq(companyTech.source, 'offre')))
      .all()
      .map((r) => r.slug)
      .sort();
    expect(offerTechs).toEqual(['php', 'symfony']);
  });
  it('rejects a blank employer name', () => {
    const db = seededDb();
    expect(() => applyLinkEmployer(db, '   ', '000000002')).toThrow("Nom d'employeur vide");
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
  it('rejects out-of-range coordinates and drops unknown headcount ranges', () => {
    const db = seededDb();
    const profile = getDefaultProfile(db);
    const base = { homeLabel: 'x', radiusKm: 10, skills: [], headcountRanges: [] };
    expect(() => applyProfile(db, profile.id, { ...base, homeLatitude: 91, homeLongitude: 0 })).toThrow(
      /latitude/i,
    );
    expect(() =>
      applyProfile(db, profile.id, { ...base, homeLatitude: 0, homeLongitude: Number.NaN }),
    ).toThrow(/longitude/i);
    applyProfile(db, profile.id, {
      ...base,
      homeLatitude: 43.7,
      homeLongitude: 7.26,
      headcountRanges: ['12', 'ZZ', '21'],
    });
    expect(getDefaultProfile(db).headcountRanges).toEqual(['12', '21']);
  });
});
