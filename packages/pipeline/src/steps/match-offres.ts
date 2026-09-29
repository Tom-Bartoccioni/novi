import { detectTechs, distanceKm, loadTechTags, normalizeCompanyName, trigramSimilarity } from '@novi/core';
import { companies, type Db, findAlias, jobOffers, upsertCompanyTech } from '@novi/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { type RunResult, withRun } from '../lib/run';
import { OFFER_TECH_CONFIDENCE, offerText } from './ingest-offres';

export const MAX_MATCH_DISTANCE_KM = 15;
export const FUZZY_THRESHOLD = 0.9;

type Candidate = { siren: string; names: string[]; latitude: number; longitude: number };

let cache: { db: Db; count: number; candidates: Candidate[] } | null = null;

function countCompanies(db: Db): number {
  return db.select({ count: sql<number>`count(*)` }).from(companies).get()?.count ?? 0;
}

function loadCandidates(db: Db): Candidate[] {
  const count = countCompanies(db);
  if (cache && cache.db === db && cache.count === count) return cache.candidates;
  const rows = db
    .select({
      siren: companies.siren,
      legalName: companies.legalName,
      name: companies.name,
      tradeNames: companies.tradeNames,
      latitude: companies.latitude,
      longitude: companies.longitude,
    })
    .from(companies)
    .all();
  const candidates = rows.map((r) => ({
    siren: r.siren,
    names: [
      ...new Set(
        [r.legalName, r.name, ...r.tradeNames].map(normalizeCompanyName).filter((n) => n.length > 0),
      ),
    ],
    latitude: r.latitude,
    longitude: r.longitude,
  }));
  cache = { db, count, candidates };
  return candidates;
}

export function invalidateCandidates(): void {
  cache = null;
}

/** Suites de chiffres trouvées dans un nom normalisé (ex. "agence web 2" -> ["2"]). */
export function numericTokens(name: string): string[] {
  return name.match(/\d+/g) ?? [];
}

export type OfferLike = { employerName: string | null; latitude: number | null; longitude: number | null };

export function findCompanyForOffer(db: Db, offer: OfferLike): string | null {
  if (!offer.employerName) return null;
  const alias = findAlias(db, offer.employerName);
  if (alias) return alias;
  const wanted = normalizeCompanyName(offer.employerName);
  if (wanted.length === 0) return null;
  const hasPoint = offer.latitude !== null && offer.longitude !== null;
  const point = hasPoint
    ? { latitude: offer.latitude as number, longitude: offer.longitude as number }
    : null;

  const wantedNumbers = numericTokens(wanted).sort().join(',');
  const scored: { siren: string; exact: boolean; similarity: number; distance: number }[] = [];
  for (const c of loadCandidates(db)) {
    const exact = c.names.includes(wanted);
    let bestName = c.names[0] ?? '';
    let similarity = exact ? 1 : 0;
    if (!exact) {
      for (const n of c.names) {
        const s = trigramSimilarity(n, wanted);
        if (s > similarity) {
          similarity = s;
          bestName = n;
        }
      }
    }
    if (!exact && similarity < FUZZY_THRESHOLD) continue;
    if (!exact && numericTokens(bestName).sort().join(',') !== wantedNumbers) continue;
    const distance = point ? distanceKm(point, c) : 0;
    if (point && distance > MAX_MATCH_DISTANCE_KM) continue;
    if (!point && !exact) continue;
    scored.push({ siren: c.siren, exact, similarity, distance });
  }
  if (scored.length === 0) return null;
  scored.sort(
    (a, b) => Number(b.exact) - Number(a.exact) || b.similarity - a.similarity || a.distance - b.distance,
  );
  if (!point && scored.filter((s) => s.exact).length >= 2) return null;
  return scored[0]?.siren ?? null;
}

export type MatchOffresOptions = { force?: boolean };

export function matchOffres(db: Db, opts: MatchOffresOptions): Promise<RunResult> {
  const tags = loadTechTags();
  return withRun(db, 'match offres', { force: opts.force ?? false }, async (ctx) => {
    invalidateCandidates();
    const where = opts.force ? undefined : and(isNull(jobOffers.siren));
    const offers = db.select().from(jobOffers).where(where).all();
    ctx.stats.matched = 0;
    for (const offer of offers) {
      ctx.stats.processed += 1;
      try {
        const siren = findCompanyForOffer(db, offer);
        if (!siren) continue;
        db.update(jobOffers).set({ siren }).where(eq(jobOffers.id, offer.id)).run();
        upsertCompanyTech(db, siren, 'offre', detectTechs(offerText(offer), tags, OFFER_TECH_CONFIDENCE));
        ctx.stats.matched += 1;
        ctx.stats.updated += 1;
      } catch (err) {
        ctx.error(undefined, err);
      }
    }
  });
}
