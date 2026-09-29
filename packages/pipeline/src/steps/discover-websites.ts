import { normalizeCompanyName, significantWords, slugify, stripAccents } from '@novi/core';
import { companies, type Db, jobOffers } from '@novi/db';
import * as cheerio from 'cheerio';
import { and, eq, isNotNull, isNull, or } from 'drizzle-orm';
import pLimit from 'p-limit';
import { fetchText } from '../lib/http';
import { log, warn } from '../lib/logger';
import { createLimiter } from '../lib/rate-limit';
import { type RunResult, withRun } from '../lib/run';
import { type BBox, fetchOsmBusinesses, matchOsmBusiness, type OsmBusiness } from '../sources/overpass';

const TLDS = ['com', 'fr', 'io', 'eu', 'tech'];

export type NameFields = { name: string; legalName: string; tradeNames: string[] };

/** Marqueurs (texte plié : sans accents, minuscules) d'une page de domaine parqué ou à vendre. */
export const PARKED_MARKERS = [
  'a vendre',
  'for sale',
  'domain for sale',
  'buy this domain',
  'parked',
  'domain parking',
  'sedo',
  'godaddy',
  'hugedomains',
  'dan.com',
  'afternic',
  'this domain',
  'ce domaine est',
  'ce nom de domaine',
  'acheter ce domaine',
];

/** Slug compact puis, pour les noms de plusieurs mots, slug avec tirets. */
function slugVariants(name: string): string[] {
  const normalized = normalizeCompanyName(name);
  const plain = normalized.replace(/\s+/g, '');
  const hyphenated = normalized.replace(/\s+/g, '-');
  return hyphenated === plain ? [plain] : [plain, hyphenated];
}

export function candidateDomains(c: NameFields): string[] {
  const bases = [
    ...new Set([...c.tradeNames, c.name, c.legalName].flatMap(slugVariants).filter((s) => s.length >= 3)),
  ];
  const out: string[] = [];
  for (const base of bases) for (const tld of TLDS) out.push(`https://${base}.${tld}`);
  return [...new Set(out)];
}

/** Vérifie que la page d'accueil correspond à l'entreprise. Avec `url`, rejette aussi les pages vides ou dont le titre n'est que le nom de domaine. */
export function verifyHomepage(html: string, c: NameFields, url?: string): boolean {
  const $ = cheerio.load(html);
  const title = $('title').text();
  const description = $('meta[name="description"]').attr('content') ?? '';
  const text = stripAccents(
    `${title} ${description} ${$('meta[property="og:title"]').attr('content') ?? ''}`,
  ).toLowerCase();
  if (PARKED_MARKERS.some((m) => text.includes(m))) return false;
  if (url) {
    if (!title.trim() && !description.trim()) return false;
    const host = new URL(url).hostname.replace(/^www\./, '');
    const foldedTitle = stripAccents(title)
      .toLowerCase()
      .replace(/[\s.-]+/g, '')
      .replace(/^www/, '');
    if (foldedTitle === host.replace(/[.-]+/g, '')) return false;
  }
  const words = new Set([...c.tradeNames, c.name, c.legalName].flatMap(significantWords));
  const slugs = [...c.tradeNames, c.name].map(slugify).filter((s) => s.length >= 4);
  return [...words].some((w) => text.includes(w)) || slugs.some((s) => text.replace(/\s+/g, '').includes(s));
}

const guessLimiter = createLimiter(8);

export type Homepage = { url: string; html: string };

/** Page d'accueil d'un domaine candidat, avec l'URL finale après redirections. */
async function defaultFetchHomepage(url: string): Promise<Homepage | null> {
  try {
    const page = await guessLimiter(() => fetchText(url, { timeoutMs: 8_000, maxBytes: 300_000 }));
    if (page.status >= 400 || !page.contentType.includes('html')) return null;
    return { url: page.url, html: page.body };
  } catch {
    return null;
  }
}

export function offerWebsiteMap(db: Db): Map<string, string> {
  const rows = db
    .select({ siren: jobOffers.siren, raw: jobOffers.raw })
    .from(jobOffers)
    .where(isNotNull(jobOffers.siren))
    .all();
  const map = new Map<string, string>();
  for (const r of rows) {
    const url = (r.raw as { entreprise?: { url?: string } } | null)?.entreprise?.url;
    if (r.siren && url && !map.has(r.siren)) map.set(r.siren, url);
  }
  return map;
}

export function bboxOf(rows: { latitude: number; longitude: number }[]): BBox | null {
  if (rows.length === 0) return null;
  const lats = rows.map((r) => r.latitude);
  const lons = rows.map((r) => r.longitude);
  const margin = 0.01;
  return {
    south: Math.min(...lats) - margin,
    west: Math.min(...lons) - margin,
    north: Math.max(...lats) + margin,
    east: Math.max(...lons) + margin,
  };
}

export type DiscoverOptions = {
  force?: boolean;
  limit?: number;
  siren?: string;
  offerUrls?: Map<string, string>;
  osm?: OsmBusiness[];
  fetchOsm?: (bbox: BBox) => Promise<OsmBusiness[]>;
  fetchHomepage?: (url: string) => Promise<Homepage | null>;
  concurrency?: number;
};

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, '');

export function discoverWebsites(db: Db, opts: DiscoverOptions): Promise<RunResult> {
  const fetchHomepage = opts.fetchHomepage ?? defaultFetchHomepage;
  const fetchOsm = opts.fetchOsm ?? fetchOsmBusinesses;
  return withRun(
    db,
    'discover websites',
    { force: opts.force ?? false, limit: opts.limit ?? null, siren: opts.siren ?? null },
    async (ctx) => {
      const notManual = or(
        isNull(companies.websiteSource),
        eq(companies.websiteSource, 'offre'),
        eq(companies.websiteSource, 'osm'),
        eq(companies.websiteSource, 'devinette'),
      );
      const where = opts.siren
        ? and(eq(companies.siren, opts.siren), notManual)
        : opts.force
          ? notManual
          : and(isNull(companies.website), notManual);
      let targets = db.select().from(companies).where(where).all();
      if (opts.limit !== undefined) targets = targets.slice(0, opts.limit);
      if (opts.siren && targets.length === 0) {
        const row = db
          .select({ websiteSource: companies.websiteSource })
          .from(companies)
          .where(eq(companies.siren, opts.siren))
          .get();
        if (row?.websiteSource === 'manuel') warn(`${opts.siren} : site renseigné manuellement, non modifié`);
      }
      log(`${targets.length} entreprises à traiter`);

      const offerUrls = opts.offerUrls ?? offerWebsiteMap(db);
      let osm = opts.osm ?? null;
      if (!osm) {
        const bbox = bboxOf(targets);
        try {
          osm = bbox ? await fetchOsm(bbox) : [];
          log(`OpenStreetMap : ${osm.length} bureaux avec site web dans la zone`);
        } catch (err) {
          ctx.error(undefined, err);
          warn('OpenStreetMap indisponible, on continue sans');
          ctx.stats.osmUnavailable = 1;
          osm = [];
        }
      }
      ctx.stats.fromOffers = 0;
      ctx.stats.fromOsm = 0;
      ctx.stats.fromGuess = 0;

      const limit = pLimit(opts.concurrency ?? 5);
      await Promise.all(
        targets.map((c) =>
          limit(async () => {
            ctx.stats.processed += 1;
            if (ctx.stats.processed % 50 === 0) log(`${ctx.stats.processed}/${targets.length}`);
            try {
              let found: {
                website: string;
                source: 'offre' | 'osm' | 'devinette';
                confidence: number;
              } | null = null;
              const fromOffer = offerUrls.get(c.siren);
              if (fromOffer) found = { website: fromOffer, source: 'offre', confidence: 0.9 };
              if (!found) {
                const b = matchOsmBusiness(c, osm);
                if (b) found = { website: b.website, source: 'osm', confidence: 0.8 };
              }
              if (!found) {
                for (const url of candidateDomains(c)) {
                  const page = await fetchHomepage(url);
                  if (page && verifyHomepage(page.html, c, page.url)) {
                    found = { website: stripTrailingSlash(page.url), source: 'devinette', confidence: 0.6 };
                    break;
                  }
                }
              }
              if (!found) return;
              db.update(companies)
                .set({
                  website: found.website,
                  websiteSource: found.source,
                  websiteConfidence: found.confidence,
                })
                .where(eq(companies.siren, c.siren))
                .run();
              ctx.stats.updated += 1;
              if (found.source === 'offre') ctx.stats.fromOffers = (ctx.stats.fromOffers ?? 0) + 1;
              else if (found.source === 'osm') ctx.stats.fromOsm = (ctx.stats.fromOsm ?? 0) + 1;
              else ctx.stats.fromGuess = (ctx.stats.fromGuess ?? 0) + 1;
            } catch (err) {
              ctx.error(c.siren, err);
            }
          }),
        ),
      );
    },
  );
}
