import {
  distanceKm as computeDistanceKm,
  detectTechs,
  isRecentOffer,
  loadTechTags,
  type ScoreResult,
  scoreCompany,
  stripAccents,
  type TechCategory,
} from '@novi/core';
import {
  type Company,
  type CompanyStatus,
  type CoverLetterWithOffer,
  type CrawlRun,
  companies,
  companiesWithinRadius,
  companyStatus,
  companyTech,
  crawlRuns,
  type Db,
  jobOffers,
  listCoverLetters,
  type Profile,
  recordOfferViews,
  seenOfferIds,
  signals,
  techTags,
} from '@novi/db';
import { and, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { googleSearchUrl, itineraryUrl, linkedinSearchUrl } from './format';

export const SORTS = ['score', 'distance', 'size'] as const;
export type Sort = (typeof SORTS)[number];

export type Filters = {
  techs: string[];
  headcount: string[];
  recruiting: boolean;
  nouvelles: boolean;
  status: CompanyStatus | null;
  sort: Sort;
  q: string;
};

const STATUSES: CompanyStatus[] = ['to_review', 'interested', 'contacted', 'rejected', 'ignored'];

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

function list(v: string | string[] | undefined): string[] {
  return first(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseFilters(params: SearchParams): Filters {
  const status = first(params.status) as CompanyStatus;
  const sort = first(params.sort) as Sort;
  return {
    techs: list(params.techs),
    headcount: list(params.headcount),
    recruiting: first(params.recruiting) === '1',
    nouvelles: first(params.nouvelles) === '1',
    status: STATUSES.includes(status) ? status : null,
    sort: SORTS.includes(sort) ? sort : 'score',
    q: first(params.q).trim(),
  };
}

export type TechSummary = { slug: string; label: string; category: TechCategory; confidence: number };

export type CompanyListItem = {
  siren: string;
  name: string;
  city: string | null;
  latitude: number;
  longitude: number;
  distanceKm: number;
  headcountRange: string | null;
  topTechs: TechSummary[];
  recruiting: boolean;
  recentOffers: number;
  unseenOffers: number;
  score: number;
  status: CompanyStatus;
};

/** Dictionnaire chargé une seule fois : `detectTechs` met en cache ses regex par identité de tableau. */
const TAGS = loadTechTags();
const tagIndex = new Map(TAGS.map((t) => [t.slug, t]));

/** Meilleure confiance par techno ; les technos `preferred` (celles du filtre) passent en tête. */
function bestTechs(rows: { tagSlug: string; confidence: number }[], preferred: string[] = []): TechSummary[] {
  const best = new Map<string, number>();
  for (const r of rows) best.set(r.tagSlug, Math.max(best.get(r.tagSlug) ?? 0, r.confidence));
  const rank = (slug: string) => (preferred.includes(slug) ? 0 : 1);
  return [...best.entries()]
    .map(([slug, confidence]) => {
      const tag = tagIndex.get(slug);
      return { slug, label: tag?.label ?? slug, category: tag?.category ?? 'tool', confidence };
    })
    .sort(
      (a, b) => rank(a.slug) - rank(b.slug) || b.confidence - a.confidence || a.label.localeCompare(b.label),
    );
}

type ScoredOffer = { id: string; techSlugs: string[]; publishedAt: string | null };
type ScoredSignal = { kind: string; value: number | null };

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function offerTechSlugs(offer: { title: string; description: string | null }): string[] {
  return detectTechs(`${offer.title}\n${offer.description ?? ''}`, TAGS, 0.8).map((d) => d.slug);
}

function activeOffersOf(db: Db, siren: string): ScoredOffer[] {
  return db
    .select({
      id: jobOffers.id,
      title: jobOffers.title,
      description: jobOffers.description,
      publishedAt: jobOffers.publishedAt,
    })
    .from(jobOffers)
    .where(and(eq(jobOffers.siren, siren), eq(jobOffers.isActive, true)))
    .all()
    .map((o) => ({ id: o.id, techSlugs: offerTechSlugs(o), publishedAt: o.publishedAt }));
}

/** Score pur : aucune requête, toutes les données sont fournies par l'appelant. */
function scoreFromParts(
  profile: Profile,
  company: Pick<Company, 'headcountRange'>,
  distanceKm: number,
  techs: { tagSlug: string; confidence: number }[],
  offers: ScoredOffer[],
  sig: ScoredSignal[],
  now: Date,
): ScoreResult {
  return scoreCompany(
    {
      skills: profile.skills,
      radiusKm: profile.radiusKm,
      headcountRanges: profile.headcountRanges,
      newOfferDays: profile.newOfferDays,
    },
    {
      headcountRange: company.headcountRange,
      techs: techs.map((t) => ({ slug: t.tagSlug, confidence: t.confidence })),
      activeOffers: offers,
      signals: sig,
    },
    distanceKm,
    now,
  );
}

export function listCompanies(
  db: Db,
  profile: Profile,
  filters: Filters,
  now: Date = new Date(),
): CompanyListItem[] {
  const inRadius = companiesWithinRadius(
    db,
    { latitude: profile.homeLatitude, longitude: profile.homeLongitude },
    profile.radiusKm,
  );
  const techRows = db
    .select({ siren: companyTech.siren, tagSlug: companyTech.tagSlug, confidence: companyTech.confidence })
    .from(companyTech)
    .all();
  const techBySiren = new Map<string, { tagSlug: string; confidence: number }[]>();
  for (const r of techRows) pushTo(techBySiren, r.siren, r);
  // Offres actives et signaux chargés en une fois ; les technos de chaque offre sont détectées une seule fois.
  const inRadiusSirens = new Set(inRadius.map((c) => c.siren));
  const offersBySiren = new Map<string, ScoredOffer[]>();
  const activeOffers = db
    .select({
      id: jobOffers.id,
      siren: jobOffers.siren,
      title: jobOffers.title,
      description: jobOffers.description,
      publishedAt: jobOffers.publishedAt,
    })
    .from(jobOffers)
    .where(and(eq(jobOffers.isActive, true), isNotNull(jobOffers.siren)))
    .all();
  for (const o of activeOffers) {
    const siren = o.siren as string;
    if (inRadiusSirens.has(siren))
      pushTo(offersBySiren, siren, { id: o.id, techSlugs: offerTechSlugs(o), publishedAt: o.publishedAt });
  }
  const signalsBySiren = new Map<string, ScoredSignal[]>();
  for (const s of db
    .select({ siren: signals.siren, kind: signals.kind, value: signals.value })
    .from(signals)
    .all())
    pushTo(signalsBySiren, s.siren, { kind: s.kind, value: s.value });
  const statusBySiren = new Map(
    db
      .select({ siren: companyStatus.siren, status: companyStatus.status })
      .from(companyStatus)
      .where(eq(companyStatus.profileId, profile.id))
      .all()
      .map((r) => [r.siren, r.status]),
  );
  const seen = seenOfferIds(db, profile.id);
  const q = filters.q.toLowerCase();

  const items: CompanyListItem[] = [];
  for (const c of inRadius) {
    const techs = techBySiren.get(c.siren) ?? [];
    const status = statusBySiren.get(c.siren) ?? 'to_review';
    const offers = offersBySiren.get(c.siren) ?? [];
    const recruiting = offers.length > 0;
    const recentOffers = offers.filter((o) => isRecentOffer(o.publishedAt, profile.newOfferDays, now)).length;
    const unseenOffers = offers.filter((o) => !seen.has(o.id)).length;
    if (filters.techs.length > 0 && !filters.techs.every((slug) => techs.some((t) => t.tagSlug === slug)))
      continue;
    if (filters.headcount.length > 0 && !filters.headcount.includes(c.headcountRange ?? '')) continue;
    if (filters.recruiting && !recruiting) continue;
    if (filters.nouvelles && recentOffers === 0) continue;
    if (filters.status && status !== filters.status) continue;
    if (q && !`${c.name} ${c.legalName} ${c.city ?? ''}`.toLowerCase().includes(q)) continue;
    items.push({
      siren: c.siren,
      name: c.name,
      city: c.city,
      latitude: c.latitude,
      longitude: c.longitude,
      distanceKm: c.distanceKm,
      headcountRange: c.headcountRange,
      topTechs: bestTechs(techs, filters.techs).slice(0, 3),
      recruiting,
      recentOffers,
      unseenOffers,
      score: scoreFromParts(profile, c, c.distanceKm, techs, offers, signalsBySiren.get(c.siren) ?? [], now)
        .score,
      status,
    });
  }
  // 'NN' (effectif non renseigné dans Sirene) se classe comme une taille inconnue.
  const sizeRank = (r: string | null) => (r && r !== 'NN' ? Number.parseInt(r, 10) || 0 : -1);
  items.sort((a, b) => {
    if (filters.sort === 'distance') return a.distanceKm - b.distanceKm;
    if (filters.sort === 'size')
      return sizeRank(b.headcountRange) - sizeRank(a.headcountRange) || b.score - a.score;
    return b.score - a.score || a.distanceKm - b.distanceKm;
  });
  return items;
}

/** Technos présentes dans au moins une entreprise, pour le filtre. */
export function availableTechs(db: Db): { slug: string; label: string; count: number }[] {
  return db
    .select({
      slug: companyTech.tagSlug,
      label: techTags.label,
      count: sql<number>`count(distinct ${companyTech.siren})`,
    })
    .from(companyTech)
    .innerJoin(techTags, eq(techTags.slug, companyTech.tagSlug))
    .groupBy(companyTech.tagSlug, techTags.label)
    .orderBy(desc(sql`count(distinct ${companyTech.siren})`))
    .all();
}

/** Nombre d'entreprises en base, toutes zones confondues : sert à distinguer « base vide » de « aucun résultat ». */
export function countCompanies(db: Db): number {
  return db.select({ n: count() }).from(companies).get()?.n ?? 0;
}

/** Offres actives rattachées à une entreprise du rayon et jamais affichées dans une fiche. */
export function countUnseenOffersInRadius(db: Db, profile: Profile): number {
  const sirens = new Set(
    companiesWithinRadius(
      db,
      { latitude: profile.homeLatitude, longitude: profile.homeLongitude },
      profile.radiusKm,
    ).map((c) => c.siren),
  );
  const seen = seenOfferIds(db, profile.id);
  return db
    .select({ id: jobOffers.id, siren: jobOffers.siren })
    .from(jobOffers)
    .where(and(eq(jobOffers.isActive, true), isNotNull(jobOffers.siren)))
    .all()
    .filter((o) => sirens.has(o.siren as string) && !seen.has(o.id)).length;
}

export type TechDetail = {
  slug: string;
  label: string;
  inProfile: boolean;
  sources: { source: string; confidence: number; evidence: string | null; detectedAt: string }[];
};

export type TechGroup = { category: TechCategory; techs: TechDetail[] };

export type CompanyDetail = {
  company: Company;
  distanceKm: number;
  techGroups: TechGroup[];
  activeOffers: {
    id: string;
    title: string;
    contractType: string | null;
    publishedAt: string | null;
    url: string | null;
    isRecent: boolean;
    unseen: boolean;
  }[];
  signals: { kind: string; value: number | null; evidence: string | null; detectedAt: string }[];
  score: ScoreResult;
  status: CompanyStatus;
  notes: string;
  links: { linkedinSearch: string; googleSearch: string; itinerary: string };
  letters: CoverLetterWithOffer[];
};

const CATEGORY_ORDER: TechCategory[] = ['language', 'framework', 'database', 'cloud', 'tool', 'domain'];

export function getCompanyDetail(
  db: Db,
  profile: Profile,
  siren: string,
  opts: { markSeen?: boolean; now?: Date } = {},
): CompanyDetail | null {
  const company = db.select().from(companies).where(eq(companies.siren, siren)).get();
  if (!company) return null;
  const distanceKm = computeDistanceKm(
    { latitude: profile.homeLatitude, longitude: profile.homeLongitude },
    company,
  );
  const techRows = db.select().from(companyTech).where(eq(companyTech.siren, siren)).all();
  const skills = new Set(profile.skills);
  const byCategory = new Map<TechCategory, Map<string, TechDetail>>();
  for (const r of techRows) {
    const tag = tagIndex.get(r.tagSlug);
    const category = tag?.category ?? 'tool';
    const group = byCategory.get(category) ?? new Map<string, TechDetail>();
    const detail = group.get(r.tagSlug) ?? {
      slug: r.tagSlug,
      label: tag?.label ?? r.tagSlug,
      inProfile: skills.has(r.tagSlug),
      sources: [],
    };
    detail.sources.push({
      source: r.source,
      confidence: r.confidence,
      evidence: r.evidence,
      detectedAt: r.detectedAt,
    });
    group.set(r.tagSlug, detail);
    byCategory.set(category, group);
  }
  const techGroups: TechGroup[] = CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => ({
    category,
    techs: [...(byCategory.get(category)?.values() ?? [])].sort(
      (a, b) =>
        Number(b.inProfile) - Number(a.inProfile) ||
        Math.max(...b.sources.map((s) => s.confidence)) - Math.max(...a.sources.map((s) => s.confidence)),
    ),
  }));
  const now = opts.now ?? new Date();
  const offers = activeOffersOf(db, siren);
  const offerRows = db
    .select({
      id: jobOffers.id,
      title: jobOffers.title,
      contractType: jobOffers.contractType,
      publishedAt: jobOffers.publishedAt,
      url: jobOffers.url,
    })
    .from(jobOffers)
    .where(and(eq(jobOffers.siren, siren), eq(jobOffers.isActive, true)))
    .orderBy(desc(jobOffers.publishedAt))
    .all();
  // Les offres non vues sont calculées avant l'enregistrement des vues : la fiche les signale une fois.
  let unseen: Set<string>;
  if (opts.markSeen) {
    try {
      unseen = new Set(
        recordOfferViews(
          db,
          profile.id,
          offerRows.map((o) => o.id),
        ),
      );
    } catch (err) {
      // L'enregistrement des vues ne doit jamais casser l'affichage de la fiche.
      console.warn(`offer_views : ${err instanceof Error ? err.message : String(err)}`);
      unseen = new Set();
    }
  } else {
    const seen = seenOfferIds(db, profile.id);
    unseen = new Set(offerRows.filter((o) => !seen.has(o.id)).map((o) => o.id));
  }
  const activeOffers = offerRows.map((o) => ({
    ...o,
    isRecent: isRecentOffer(o.publishedAt, profile.newOfferDays, now),
    unseen: unseen.has(o.id),
  }));
  const sig = db
    .select({
      kind: signals.kind,
      value: signals.value,
      evidence: signals.evidence,
      detectedAt: signals.detectedAt,
    })
    .from(signals)
    .where(eq(signals.siren, siren))
    .orderBy(desc(signals.detectedAt))
    .all();
  const status = db
    .select()
    .from(companyStatus)
    .where(and(eq(companyStatus.profileId, profile.id), eq(companyStatus.siren, siren)))
    .get();
  return {
    company,
    distanceKm,
    techGroups,
    activeOffers,
    signals: sig,
    score: scoreFromParts(profile, company, distanceKm, techRows, offers, sig, now),
    status: status?.status ?? 'to_review',
    notes: status?.notes ?? '',
    links: {
      linkedinSearch: linkedinSearchUrl(company.name),
      googleSearch: googleSearchUrl(company.name, company.city),
      itinerary: itineraryUrl({ latitude: profile.homeLatitude, longitude: profile.homeLongitude }, company),
    },
    letters: listCoverLetters(db, profile.id, siren),
  };
}

export type UnmatchedGroup = {
  employerName: string;
  count: number;
  offers: {
    id: string;
    title: string;
    city: string | null;
    publishedAt: string | null;
    url: string | null;
  }[];
};

export function listUnmatchedOffers(db: Db): UnmatchedGroup[] {
  const rows = db
    .select({
      id: jobOffers.id,
      title: jobOffers.title,
      city: jobOffers.city,
      publishedAt: jobOffers.publishedAt,
      url: jobOffers.url,
      employerName: jobOffers.employerName,
    })
    .from(jobOffers)
    .where(and(isNull(jobOffers.siren), eq(jobOffers.isActive, true), isNotNull(jobOffers.employerName)))
    .orderBy(desc(jobOffers.publishedAt))
    .all();
  const groups = new Map<string, UnmatchedGroup>();
  for (const r of rows) {
    const name = r.employerName as string;
    const g = groups.get(name) ?? { employerName: name, count: 0, offers: [] };
    g.count += 1;
    g.offers.push({ id: r.id, title: r.title, city: r.city, publishedAt: r.publishedAt, url: r.url });
    groups.set(name, g);
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.employerName.localeCompare(b.employerName),
  );
}

export function searchCompaniesByName(
  db: Db,
  q: string,
): { siren: string; name: string; city: string | null }[] {
  // Les jokers LIKE (`%`, `_`) et l'échappement (`\`) de la saisie sont neutralisés.
  // Limite : `lower()` de SQLite ne replie que l'ASCII, donc seuls les accents de la saisie sont
  // retirés ; un nom stocké avec accents ne correspond qu'à une saisie accentuée à l'identique.
  const needle = stripAccents(q.trim())
    .toLowerCase()
    .replace(/[\\%_]/g, '\\$&');
  if (!needle) return [];
  const pattern = `%${needle}%`;
  return db
    .select({ siren: companies.siren, name: companies.name, city: companies.city })
    .from(companies)
    .where(
      sql`lower(${companies.name}) like ${pattern} escape '\\' or lower(${companies.legalName}) like ${pattern} escape '\\'`,
    )
    .orderBy(companies.name)
    .limit(20)
    .all();
}

export type RunStatus = 'done' | 'running' | 'aborted';
export type RunWithStatus = CrawlRun & { status: RunStatus };

/** Au-delà de ce délai sans fin enregistrée, un run est considéré comme interrompu. */
const RUNNING_MAX_MS = 2 * 60 * 60 * 1000;
/** Au-delà de ce délai depuis le dernier refresh terminé, la page pipeline le signale comme ancien. */
const REFRESH_STALE_AFTER_MS = 12 * 60 * 60 * 1000;

function runStatus(run: CrawlRun, now: number): RunStatus {
  if (run.finishedAt) return 'done';
  const started = Date.parse(run.startedAt);
  return Number.isNaN(started) || now - started > RUNNING_MAX_MS ? 'aborted' : 'running';
}

export function pipelineOverview(db: Db, nowDate: Date = new Date()) {
  const one = (q: { get: () => { c: number } | undefined }) => q.get()?.c ?? 0;
  const now = nowDate.getTime();
  const runs: RunWithStatus[] = db
    .select()
    .from(crawlRuns)
    .orderBy(desc(crawlRuns.id))
    .limit(20)
    .all()
    .map((run) => ({ ...run, status: runStatus(run, now) }));
  const lastRefreshRow = db
    .select()
    .from(crawlRuns)
    .where(and(eq(crawlRuns.command, 'refresh'), isNotNull(crawlRuns.finishedAt)))
    .orderBy(desc(crawlRuns.id))
    .get();
  const lastRefresh: RunWithStatus | null = lastRefreshRow
    ? { ...lastRefreshRow, status: runStatus(lastRefreshRow, now) }
    : null;
  const refreshStale =
    !!lastRefresh?.finishedAt && now - Date.parse(lastRefresh.finishedAt) > REFRESH_STALE_AFTER_MS;
  return {
    runs,
    lastRefresh,
    refreshStale,
    counts: {
      companies: one(db.select({ c: count() }).from(companies)),
      withWebsite: one(db.select({ c: count() }).from(companies).where(isNotNull(companies.website))),
      crawled: one(db.select({ c: count() }).from(companies).where(isNotNull(companies.lastCrawledAt))),
      techDetections: one(db.select({ c: count() }).from(companyTech)),
      activeOffers: one(db.select({ c: count() }).from(jobOffers).where(eq(jobOffers.isActive, true))),
      unmatchedOffers: one(
        db
          .select({ c: count() })
          .from(jobOffers)
          .where(and(eq(jobOffers.isActive, true), isNull(jobOffers.siren))),
      ),
    },
  };
}
