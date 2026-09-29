import { type Detection, type DetectionSource, normalizeCompanyName, type TechTag } from '@novi/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './client';
import {
  companies,
  companyTech,
  employerAliases,
  profiles,
  type SignalKind,
  signals,
  techTags,
} from './schema';

export function syncTechTags(db: Db, tags: TechTag[]): void {
  db.transaction((tx) => {
    for (const t of tags) {
      tx.insert(techTags)
        .values({
          slug: t.slug,
          label: t.label,
          category: t.category,
          aliases: t.aliases,
          contextRequired: t.contextRequired ?? null,
        })
        .onConflictDoUpdate({
          target: techTags.slug,
          set: {
            label: t.label,
            category: t.category,
            aliases: t.aliases,
            contextRequired: t.contextRequired ?? null,
          },
        })
        .run();
    }
  });
}

export const DEFAULT_PROFILE = {
  name: 'Moi',
  homeLabel: 'Nice',
  homeLatitude: 43.7102,
  homeLongitude: 7.262,
  radiusKm: 30,
  skills: [] as string[],
  headcountRanges: ['03', '11', '12', '21', '22'],
};

export function ensureDefaultProfile(db: Db) {
  const existing = db.select().from(profiles).limit(1).get();
  if (existing) return existing;
  return db.insert(profiles).values(DEFAULT_PROFILE).returning().get();
}

export function getDefaultProfile(db: Db) {
  return ensureDefaultProfile(db);
}

/** Remplace toutes les technos d'une entreprise pour une source donnée. */
export function replaceCompanyTech(
  db: Db,
  siren: string,
  source: DetectionSource,
  detections: Detection[],
): void {
  db.transaction((tx) => {
    tx.delete(companyTech)
      .where(and(eq(companyTech.siren, siren), eq(companyTech.source, source)))
      .run();
    for (const d of detections) {
      tx.insert(companyTech)
        .values({ siren, tagSlug: d.slug, source, confidence: d.confidence, evidence: d.evidence })
        .onConflictDoNothing()
        .run();
    }
  });
}

/** Ajoute des technos sans supprimer les existantes ; garde la meilleure confiance. */
export function upsertCompanyTech(
  db: Db,
  siren: string,
  source: DetectionSource,
  detections: Detection[],
): void {
  db.transaction((tx) => {
    for (const d of detections) {
      tx.insert(companyTech)
        .values({ siren, tagSlug: d.slug, source, confidence: d.confidence, evidence: d.evidence })
        .onConflictDoUpdate({
          target: [companyTech.siren, companyTech.tagSlug, companyTech.source],
          set: {
            confidence: sql`max(${companyTech.confidence}, ${d.confidence})`,
            evidence: sql`case when ${d.confidence} > ${companyTech.confidence} then ${d.evidence} else ${companyTech.evidence} end`,
          },
        })
        .run();
    }
  });
}

/** Remplace, pour une entreprise, les signaux des types donnés. */
export function replaceSignals(
  db: Db,
  siren: string,
  kinds: SignalKind[],
  rows: { kind: SignalKind; value: number | null; evidence: string | null }[],
): void {
  db.transaction((tx) => {
    tx.delete(signals)
      .where(and(eq(signals.siren, siren), inArray(signals.kind, kinds)))
      .run();
    for (const r of rows)
      tx.insert(signals)
        .values({ siren, ...r })
        .run();
  });
}

export function findAlias(db: Db, employerName: string): string | null {
  const row = db
    .select({ siren: employerAliases.siren })
    .from(employerAliases)
    .where(eq(employerAliases.employerNameNormalized, normalizeCompanyName(employerName)))
    .get();
  return row?.siren ?? null;
}

export function saveAlias(db: Db, employerName: string, siren: string): void {
  db.insert(employerAliases)
    .values({ employerNameNormalized: normalizeCompanyName(employerName), siren })
    .onConflictDoUpdate({ target: employerAliases.employerNameNormalized, set: { siren } })
    .run();
}

export function companyExists(db: Db, siren: string): boolean {
  return (
    db.select({ siren: companies.siren }).from(companies).where(eq(companies.siren, siren)).get() !==
    undefined
  );
}
