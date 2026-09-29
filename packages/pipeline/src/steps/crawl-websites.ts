import {
  allCrawlPaths,
  type Detection,
  detectEsn,
  detectFingerprints,
  detectTechs,
  loadCrawlPaths,
  loadEsnKeywords,
  loadTechTags,
  mergeDetections,
} from '@novi/core';
import { companies, type Db, replaceCompanyTech, replaceSignals } from '@novi/db';
import * as cheerio from 'cheerio';
import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import pLimit from 'p-limit';
import robotsParser from 'robots-parser';
import { fetchText, type TextPage, USER_AGENT } from '../lib/http';
import { log } from '../lib/logger';
import { sleep } from '../lib/rate-limit';
import { type RunResult, withRun } from '../lib/run';

export const MAX_PAGES = 12;
const RECRAWL_AFTER_DAYS = 30;
const CAREER_WORDS = ['carri', 'career', 'recrut', 'job', 'rejoin', 'join'];
const TECH_PAGE_WORDS = [
  ...CAREER_WORDS,
  'tech',
  'stack',
  'engineering',
  'equipe',
  'team',
  'about',
  'propos',
];

export function visibleText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, template').remove();
  const blocks: string[] = [];
  $('body')
    .find('p, h1, h2, h3, h4, h5, h6, li, td, th, dd, dt, blockquote, figcaption, span, a, div')
    .each((_, el) => {
      const own = $(el).clone().children().remove().end().text().replace(/\s+/g, ' ').trim();
      if (own) blocks.push(own);
    });
  if (blocks.length === 0) return $('body').text().replace(/\s+/g, ' ').trim();
  return blocks.join('\n');
}

export type Link = { href: string; text: string };
export type Links = { internal: string[]; anchors: Link[]; github: string | null; linkedin: string | null };

const PERSONAL_GITHUB = new Set([
  'features',
  'topics',
  'sponsors',
  'about',
  'pricing',
  'login',
  'join',
  'marketplace',
  'explore',
]);

/** Même site à « www. » près. */
function sameHost(a: string, b: string): boolean {
  return a.replace(/^www\./, '') === b.replace(/^www\./, '');
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function extractLinks(html: string, baseUrl: string): Links {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const internal = new Set<string>();
  const anchors: Link[] = [];
  let github: string | null = null;
  let linkedin: string | null = null;
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:'))
      return;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    url.hash = '';
    if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
      const org = url.pathname.split('/').filter(Boolean)[0];
      if (org && !PERSONAL_GITHUB.has(org.toLowerCase()) && !github) github = org;
      return;
    }
    if (url.hostname.endsWith('linkedin.com') && url.pathname.includes('/company/') && !linkedin) {
      linkedin = url.toString();
      return;
    }
    if (sameHost(url.hostname, base.hostname)) {
      const clean = url.toString().replace(/\/$/, '');
      internal.add(clean);
      anchors.push({ href: clean, text: $(el).text().replace(/\s+/g, ' ').trim() });
    }
  });
  return { internal: [...internal], anchors, github, linkedin };
}

/** Mots-clés carrière dans le texte du lien ou le chemin de l'URL (jamais dans le nom d'hôte). */
function looksLikeCareer(text: string, href: string): boolean {
  const hay = `${text} ${pathOf(href)}`.toLowerCase();
  return CAREER_WORDS.some((w) => hay.includes(w));
}

export function selectPages(baseUrl: string, internal: string[], anchors: Link[]): string[] {
  const root = baseUrl.replace(/\/$/, '');
  const ordered: string[] = [root];
  const push = (u: string) => {
    if (!ordered.includes(u) && ordered.length < MAX_PAGES) ordered.push(u);
  };
  for (const a of anchors) if (looksLikeCareer(a.text, a.href)) push(a.href);
  for (const path of allCrawlPaths()) {
    const candidate = `${root}${path}`;
    if (internal.includes(candidate)) push(candidate);
  }
  // Sondage équilibré : une famille après l'autre (carrière, présentation, technique, autres).
  const families = loadCrawlPaths();
  const lists = [families.careers, families.about, families.tech, families.other];
  const longest = Math.max(...lists.map((l) => l.length));
  for (let i = 0; i < longest; i += 1) {
    for (const list of lists) {
      const path = list[i];
      if (path) push(`${root}${path}`);
    }
  }
  return ordered.slice(0, MAX_PAGES);
}

export type SiteAnalysis = {
  description: string | null;
  careersUrl: string | null;
  githubOrg: string | null;
  linkedinUrl: string | null;
  detections: Detection[];
  esnEvidence: string | null;
};

export function analyzeSite(baseUrl: string, pages: TextPage[]): SiteAnalysis {
  const tags = loadTechTags();
  const esnKeywords = loadEsnKeywords();
  const home = pages.find((p) => p.url.replace(/\/$/, '') === baseUrl.replace(/\/$/, '')) ?? pages[0];
  let description: string | null = null;
  let careersUrl: string | null = null;
  let githubOrg: string | null = null;
  let linkedinUrl: string | null = null;
  let esnEvidence: string | null = null;
  const lists: Detection[][] = [];

  if (home) {
    const $ = cheerio.load(home.body);
    description =
      $('meta[name="description"]').attr('content')?.trim() ||
      $('meta[property="og:description"]').attr('content')?.trim() ||
      null;
  }
  for (const p of pages) {
    const links = extractLinks(p.body, baseUrl);
    githubOrg = githubOrg ?? links.github;
    linkedinUrl = linkedinUrl ?? links.linkedin;
    const path = pathOf(p.url);
    const isCareer = looksLikeCareer('', p.url) && p.url.replace(/\/$/, '') !== baseUrl.replace(/\/$/, '');
    if (isCareer && !careersUrl) careersUrl = p.url;
    if (!careersUrl) {
      const careerLink = links.anchors.find((a) => looksLikeCareer(a.text, a.href));
      if (careerLink) careersUrl = careerLink.href;
    }
    const text = visibleText(p.body);
    const technical = TECH_PAGE_WORDS.some((w) => path.includes(w));
    lists.push(detectTechs(text, tags, technical ? 0.7 : 0.5));
    lists.push(detectFingerprints(p.body, p.headers, tags));
    esnEvidence = esnEvidence ?? detectEsn(text, esnKeywords);
  }
  return {
    description,
    careersUrl,
    githubOrg,
    linkedinUrl,
    detections: mergeDetections(...lists),
    esnEvidence,
  };
}

export type CrawlDeps = {
  fetchPage?: (url: string) => Promise<TextPage | null>;
  robotsAllowed?: (url: string) => Promise<boolean>;
};

async function defaultFetchPage(url: string): Promise<TextPage | null> {
  try {
    const page = await fetchText(url, { timeoutMs: 10_000, maxBytes: 2_000_000 });
    if (page.status >= 400 || !page.contentType.includes('html')) return null;
    return page;
  } catch {
    return null;
  }
}

const robotsCache = new Map<string, ReturnType<typeof robotsParser> | null>();

async function defaultRobotsAllowed(url: string): Promise<boolean> {
  const origin = new URL(url).origin;
  if (!robotsCache.has(origin)) {
    try {
      const page = await fetchText(`${origin}/robots.txt`, { timeoutMs: 8_000, maxBytes: 100_000 });
      robotsCache.set(origin, page.status === 200 ? robotsParser(`${origin}/robots.txt`, page.body) : null);
    } catch {
      robotsCache.set(origin, null);
    }
  }
  const robots = robotsCache.get(origin);
  return robots ? (robots.isAllowed(url, USER_AGENT) ?? true) : true;
}

/** Crawl et analyse d'une seule entreprise. Utilisé par la CLI et par l'app (bouton « Analyser le site »). */
export async function crawlCompany(db: Db, siren: string, deps: CrawlDeps = {}): Promise<SiteAnalysis> {
  const fetchPage = deps.fetchPage ?? defaultFetchPage;
  const robotsAllowed = deps.robotsAllowed ?? defaultRobotsAllowed;
  const company = db.select().from(companies).where(eq(companies.siren, siren)).get();
  if (!company) throw new Error(`Entreprise inconnue : ${siren}`);
  if (!company.website) throw new Error(`Pas de site web pour ${company.name}`);
  const baseUrl = company.website.replace(/\/$/, '');
  if (!(await robotsAllowed(baseUrl))) throw new Error(`robots.txt interdit le crawl de ${baseUrl}`);
  const home = await fetchPage(baseUrl);
  if (!home) throw new Error(`Page d'accueil inaccessible : ${baseUrl}`);
  // Base effective : l'origine finale après redirections (ex. https://x.com -> https://www.x.com).
  const siteBase = new URL(home.url).origin;
  const pages: TextPage[] = [home];
  const links = extractLinks(home.body, siteBase);
  for (const url of selectPages(siteBase, links.internal, links.anchors).slice(1)) {
    if (deps.fetchPage === undefined) await sleep(1000);
    if (!(await robotsAllowed(url))) continue;
    const p = await fetchPage(url);
    if (p) pages.push(p);
  }
  const analysis = analyzeSite(siteBase, pages);
  db.update(companies)
    .set({
      description: analysis.description,
      careersUrl: analysis.careersUrl,
      githubOrg: analysis.githubOrg ?? company.githubOrg,
      linkedinUrl: analysis.linkedinUrl ?? company.linkedinUrl,
      lastCrawledAt: new Date().toISOString(),
    })
    .where(eq(companies.siren, siren))
    .run();
  replaceCompanyTech(db, siren, 'site', analysis.detections);
  replaceSignals(
    db,
    siren,
    ['esn_suspected'],
    analysis.esnEvidence ? [{ kind: 'esn_suspected', value: null, evidence: analysis.esnEvidence }] : [],
  );
  return analysis;
}

export type CrawlOptions = CrawlDeps & {
  force?: boolean;
  limit?: number;
  siren?: string;
  concurrency?: number;
};

export function crawlWebsites(db: Db, opts: CrawlOptions): Promise<RunResult> {
  return withRun(
    db,
    'crawl websites',
    { force: opts.force ?? false, limit: opts.limit ?? null, siren: opts.siren ?? null },
    async (ctx) => {
      const cutoff = new Date(Date.now() - RECRAWL_AFTER_DAYS * 86_400_000).toISOString();
      const where = opts.siren
        ? eq(companies.siren, opts.siren)
        : opts.force
          ? isNotNull(companies.website)
          : and(
              isNotNull(companies.website),
              or(isNull(companies.lastCrawledAt), lt(companies.lastCrawledAt, cutoff)),
            );
      let targets = db
        .select({ siren: companies.siren, name: companies.name })
        .from(companies)
        .where(where)
        .all();
      if (opts.limit !== undefined) targets = targets.slice(0, opts.limit);
      log(`${targets.length} sites à analyser`);
      const limit = pLimit(opts.concurrency ?? 5);
      await Promise.all(
        targets.map((t) =>
          limit(async () => {
            ctx.stats.processed += 1;
            try {
              const a = await crawlCompany(db, t.siren, opts);
              ctx.stats.updated += 1;
              log(
                `${t.name} : ${a.detections.length} technos${a.careersUrl ? ', page carrière' : ''}${a.esnEvidence ? ', ESN ?' : ''}`,
              );
            } catch (err) {
              ctx.error(t.siren, err);
            }
          }),
        ),
      );
    },
  );
}
