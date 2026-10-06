import type { IdentityHints } from '@novi/assist';
import { detectTechs, HEADCOUNT_LABELS, loadTechTags } from '@novi/core';
import {
  COMPANY_STATUSES,
  type CompanyStatus,
  companies,
  companyExists,
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
  if (!companyExists(database, siren)) throw new Error(`Entreprise inconnue : ${siren}`);
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
  if (!companyExists(database, siren)) throw new Error(`Entreprise inconnue : ${siren}`);
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
  url.username = '';
  url.password = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

/** Enregistre le site saisi à la main et renvoie l'URL normalisée. */
export function applyWebsite(database: Db, siren: string, website: string): string {
  const url = normalizeUrl(website);
  if (!companyExists(database, siren)) throw new Error(`Entreprise inconnue : ${siren}`);
  database
    .update(companies)
    .set({ website: url, websiteSource: 'manuel', websiteConfidence: 1 })
    .where(eq(companies.siren, siren))
    .run();
  return url;
}

export function applyLinkEmployer(database: Db, employerName: string, siren: string): { linked: number } {
  if (!employerName.trim()) throw new Error("Nom d'employeur vide");
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
  // V2, facultatifs : absents, les colonnes correspondantes ne sont pas modifiées.
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  postalAddress?: string;
  links?: string[];
  revealFirstName?: boolean;
  newOfferDays?: number;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function nullable(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function normalizeLinks(links: string[]): string[] {
  const normalized = links
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return normalizeUrl(l);
      } catch {
        throw new Error(`Lien invalide : ${l}`);
      }
    });
  return [...new Set(normalized)];
}

export function applyProfile(database: Db, profileId: number, input: ProfileInput): void {
  if (!(input.radiusKm >= 1 && input.radiusKm <= 200))
    throw new Error('Le rayon doit être entre 1 et 200 km');
  if (!input.homeLabel.trim()) throw new Error('Adresse manquante');
  if (!(Number.isFinite(input.homeLatitude) && Math.abs(input.homeLatitude) <= 90))
    throw new Error('Latitude invalide');
  if (!(Number.isFinite(input.homeLongitude) && Math.abs(input.homeLongitude) <= 180))
    throw new Error('Longitude invalide');
  if (
    input.newOfferDays !== undefined &&
    !(Number.isInteger(input.newOfferDays) && input.newOfferDays >= 1 && input.newOfferDays <= 90)
  )
    throw new Error('La fenêtre de nouveauté doit être un nombre entier de jours entre 1 et 90');
  const email = nullable(input.email);
  if (email && !EMAIL_RE.test(email)) throw new Error('Adresse e-mail invalide');
  // `anonymize` ne masque pas les noms de moins de 3 caractères : un tel nom partirait en clair.
  const lastName = nullable(input.lastName);
  if (lastName && lastName.length < 3)
    throw new Error('Le nom doit faire au moins 3 caractères pour pouvoir être masqué');
  const known = new Set(loadTechTags().map((t) => t.slug));
  const knownRanges = new Set(Object.keys(HEADCOUNT_LABELS));
  const set: Partial<typeof profiles.$inferInsert> = {
    homeLabel: input.homeLabel.trim(),
    homeLatitude: input.homeLatitude,
    homeLongitude: input.homeLongitude,
    radiusKm: input.radiusKm,
    skills: input.skills.filter((s) => known.has(s)),
    headcountRanges: input.headcountRanges.filter((r) => knownRanges.has(r)),
  };
  if (input.firstName !== undefined) set.firstName = nullable(input.firstName);
  if (input.lastName !== undefined) set.lastName = lastName;
  if (input.email !== undefined) set.email = email;
  if (input.phone !== undefined) set.phone = nullable(input.phone);
  if (input.postalAddress !== undefined) set.postalAddress = nullable(input.postalAddress);
  if (input.links !== undefined) set.links = normalizeLinks(input.links);
  if (input.revealFirstName !== undefined) set.revealFirstName = input.revealFirstName;
  if (input.newOfferDays !== undefined) set.newOfferDays = input.newOfferDays;
  database.update(profiles).set(set).where(eq(profiles.id, profileId)).run();
}

export type CvInput = { filename: string; text: string; pages: number };

/** Remplace le CV du profil et complète les champs d'identité encore vides avec les indices détectés. */
export function applyCv(database: Db, profileId: number, cv: CvInput, hints: IdentityHints): void {
  const current = database.select().from(profiles).where(eq(profiles.id, profileId)).get();
  if (!current) throw new Error('Profil introuvable');
  database
    .update(profiles)
    .set({
      cvFilename: cv.filename,
      cvText: cv.text,
      cvPages: cv.pages,
      cvUploadedAt: new Date().toISOString(),
      email: current.email ?? hints.email ?? null,
      phone: current.phone ?? hints.phone ?? null,
      links: current.links.length > 0 ? current.links : hints.links,
    })
    .where(eq(profiles.id, profileId))
    .run();
}
