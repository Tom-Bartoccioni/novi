import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { companies, companyTech, createDb, migrateAndSeed, signals } from '@novi/db';
import { describe, expect, it } from 'vitest';
import type { TextPage } from '../src/lib/http';
import {
  analyzeSite,
  crawlCompany,
  crawlWebsites,
  extractLinks,
  selectPages,
  visibleText,
} from '../src/steps/crawl-websites';

const html = readFileSync(join(import.meta.dirname, 'fixtures/site-cliken.html'), 'utf8');
const base = 'https://www.cliken-web.com';

function page(url: string, body: string, headers: Record<string, string> = {}): TextPage {
  return {
    url,
    status: 200,
    headers: { 'content-type': 'text/html', ...headers },
    body,
    contentType: 'text/html',
  };
}

describe('visibleText', () => {
  it('drops scripts and collapses whitespace', () => {
    const text = visibleText(
      '<html><body><script>var x</script><p>Bonjour   le</p><p>monde.</p></body></html>',
    );
    expect(text).toBe('Bonjour le\nmonde.');
  });
});

describe('extractLinks', () => {
  it('returns absolute internal links and external github/linkedin links', () => {
    const links = extractLinks(html, base);
    expect(links.internal).toContain('https://www.cliken-web.com/a-propos');
    expect(links.internal).toContain('https://www.cliken-web.com/nous-rejoindre');
    expect(links.github).toBe('cliken-web');
    expect(links.linkedin).toBe('https://www.linkedin.com/company/cliken-web/');
  });
});

describe('selectPages', () => {
  it('combines config paths, career-like links, capped at 12, homepage first', () => {
    const pages = selectPages(
      base,
      [
        'https://www.cliken-web.com/nous-rejoindre',
        'https://www.cliken-web.com/blog/post-1',
        'https://www.cliken-web.com/contact',
      ],
      [
        { href: 'https://www.cliken-web.com/nous-rejoindre', text: 'Nous rejoindre' },
        { href: 'https://www.cliken-web.com/contact', text: 'Contact' },
      ],
    );
    expect(pages[0]).toBe(base);
    expect(pages).toContain('https://www.cliken-web.com/nous-rejoindre');
    expect(pages).toContain('https://www.cliken-web.com/carrieres');
    expect(pages).not.toContain('https://www.cliken-web.com/contact');
    expect(pages.length).toBeLessThanOrEqual(12);
  });
});

describe('analyzeSite', () => {
  it('extracts description, careers, github, linkedin, techs with sources, and ESN', () => {
    const result = analyzeSite(base, [
      page(base, html, { server: 'cloudflare' }),
      page(
        `${base}/nous-rejoindre`,
        '<html><body><h1>Rejoignez-nous</h1><p>Nous cherchons un développeur Rust backend.</p></body></html>',
      ),
    ]);
    expect(result.description).toBe('Cliken Web conçoit des sites et applications web sur mesure.');
    expect(result.careersUrl).toBe(`${base}/nous-rejoindre`);
    expect(result.githubOrg).toBe('cliken-web');
    expect(result.linkedinUrl).toBe('https://www.linkedin.com/company/cliken-web/');
    const bySlug = Object.fromEntries(result.detections.map((d) => [d.slug, d]));
    expect(bySlug.nextjs?.confidence).toBe(0.9);
    expect(bySlug.cloudflare?.confidence).toBe(0.9);
    expect(bySlug.react?.confidence).toBe(0.5);
    expect(bySlug.rust?.confidence).toBe(0.7);
    expect(result.esnEvidence).toBe('Nous sommes une ESN à taille humaine.');
  });
});

describe('crawlCompany / crawlWebsites', () => {
  it('persists the analysis and replaces previous site detections', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    db.insert(companies)
      .values({
        siren: '000000001',
        name: 'Cliken Web',
        legalName: 'CLIKEN WEB PRO',
        nafCode: '62.01Z',
        siretLocal: 'a',
        latitude: 43.62,
        longitude: 7.04,
        website: base,
        websiteSource: 'manuel',
        websiteConfidence: 1,
      })
      .run();
    const fetchPage = async (url: string) => (url === base ? page(base, html) : null);
    await crawlCompany(db, '000000001', { fetchPage, robotsAllowed: async () => true });
    let techs = db.select().from(companyTech).all();
    expect(techs.map((t) => t.tagSlug)).toContain('nextjs');
    expect(techs.every((t) => t.source === 'site')).toBe(true);
    expect(
      db
        .select()
        .from(signals)
        .all()
        .map((s) => s.kind),
    ).toEqual(['esn_suspected']);
    const row = db.select().from(companies).get();
    expect(row?.githubOrg).toBe('cliken-web');
    expect(row?.lastCrawledAt).toBeTruthy();

    const fetchPage2 = async (url: string) =>
      url === base
        ? page(
            base,
            '<html><head><title>Cliken</title></head><body><p>Nous utilisons le framework Vue.</p></body></html>',
          )
        : null;
    const result = await crawlWebsites(db, {
      force: true,
      fetchPage: fetchPage2,
      robotsAllowed: async () => true,
    });
    expect(result.stats.processed).toBe(1);
    techs = db.select().from(companyTech).all();
    expect(techs.map((t) => t.tagSlug)).toEqual(['vue']);
    expect(db.select().from(signals).all()).toEqual([]);
  });
});
