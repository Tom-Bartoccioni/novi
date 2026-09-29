import { detectTechs, loadTechTags } from '@novi/core';
import {
  COMPANY_STATUSES,
  type CompanyStatus,
  companies,
  companyStatus,
  type Db,
  jobOffers,
  profiles,
  saveAlias,
  upsertCompanyTech,
} from '@novi/db';
import { OFFER_TECH_CONFIDENCE } from '@novi/pipeline';
import { and, eq, isNull } from 'drizzle-orm';

export function applyStatus(database: Db, profileId: number, siren: string, status: string): void {
  if (!(COMPANY_STATUSES as readonly string[]).includes(status))
    throw new Error(`Statut inconnu : ${status}`);
  database
    .insert(companyStatus)
    .values({ profileId, siren, status: status as CompanyStatus })
    .onConflictDoUpdate({
      target: [companyStatus.profileId, companyStatus.siren],
      set: { status: status as CompanyStatus },
    })
    .run();
}

export function applyNotes(database: Db, profileId: number, siren: string, notes: string): void {
  database
    .insert(companyStatus)
    .values({ profileId, siren, notes })
    .onConflictDoUpdate({ target: [companyStatus.profileId, companyStatus.siren], set: { notes } })
    .run();
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('URL invalide');
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) throw new Error('URL invalide');
  return url.toString().replace(/\/$/, '');
}

export function applyWebsite(database: Db, siren: string, website: string): void {
  const url = normalizeUrl(website);
  database
    .update(companies)
    .set({ website: url, websiteSource: 'manuel', websiteConfidence: 1 })
    .where(eq(companies.siren, siren))
    .run();
}

export function applyLinkEmployer(database: Db, employerName: string, siren: string): { linked: number } {
  const tags = loadTechTags();
  const offers = database
    .select()
    .from(jobOffers)
    .where(and(isNull(jobOffers.siren), eq(jobOffers.employerName, employerName)))
    .all();
  database.transaction((tx) => {
    for (const o of offers) tx.update(jobOffers).set({ siren }).where(eq(jobOffers.id, o.id)).run();
  });
  for (const o of offers) {
    upsertCompanyTech(
      database,
      siren,
      'offre',
      detectTechs(`${o.title}\n${o.description ?? ''}`, tags, OFFER_TECH_CONFIDENCE),
    );
  }
  saveAlias(database, employerName, siren);
  return { linked: offers.length };
}

export type ProfileInput = {
  homeLabel: string;
  homeLatitude: number;
  homeLongitude: number;
  radiusKm: number;
  skills: string[];
  headcountRanges: string[];
};

export function applyProfile(database: Db, profileId: number, input: ProfileInput): void {
  if (!(input.radiusKm >= 1 && input.radiusKm <= 200))
    throw new Error('Le rayon doit être entre 1 et 200 km');
  if (!input.homeLabel.trim()) throw new Error('Adresse manquante');
  const known = new Set(loadTechTags().map((t) => t.slug));
  database
    .update(profiles)
    .set({
      homeLabel: input.homeLabel.trim(),
      homeLatitude: input.homeLatitude,
      homeLongitude: input.homeLongitude,
      radiusKm: input.radiusKm,
      skills: input.skills.filter((s) => known.has(s)),
      headcountRanges: input.headcountRanges,
    })
    .where(eq(profiles.id, profileId))
    .run();
}
