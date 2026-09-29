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

  it('keeps the text of inline tags inside a block', () => {
    const text = visibleText(
      '<html><body><p>Notre stack : <strong>React</strong>, <code>Go</code> et <em>PostgreSQL</em></p></body></html>',
    );
    expect(text).toBe('Notre stack : React, Go et PostgreSQL');
  });

  it('keeps text placed directly inside sections and main, one line per block', () => {
    const text = visibleText(
      '<html><body><section><h2>Titre</h2>Texte de section <b>Rust</b> et Python.</section><main>Nous utilisons Kubernetes.</main></body></html>',
    );
    expect(text.split('\n')).toEqual([
      'Titre',
      'Texte de section Rust et Python.',
      'Nous utilisons Kubernetes.',
    ]);
  });

  it('emits one line per list item', () => {
    expect(visibleText('<html><body><ul><li>React</li><li>Vue</li></ul></body></html>')).toBe('React\nVue');
  });

  it('separates adjacent inline elements that have no whitespace between them', () => {
    const text = visibleText(
      '<html><body><nav><a>Accueil</a><a>React</a><a>Angular</a></nav><div><span>Django</span><span>Symfony</span></div></body></html>',
    );
    expect(text).toBe('Accueil React Angular\nDjango Symfony');
  });

  it('removes scripts even when nested inside blocks', () => {
    const text = visibleText(
      '<html><body><div><script>window.x = "Angular"</script><p>Nous aimons <b>Vue</b>.</p></div></body></html>',
    );
    expect(text).toBe('Nous aimons Vue.');
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

describe('host handling', () => {
  it('treats www. and bare hosts as the same site', () => {
    const links = extractLinks('<a href="https://www.inotekk.com/carrieres">x</a>', 'https://inotekk.com');
    expect(links.internal).toContain('https://www.inotekk.com/carrieres');
  });

  it('follows the redirected www host for the rest of the crawl', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    db.insert(companies)
      .values({
        siren: '000000002',
        name: 'Example',
        legalName: 'EXAMPLE',
        nafCode: '62.01Z',
        siretLocal: 'b',
        latitude: 43.62,
        longitude: 7.04,
        website: 'https://example.com',
        websiteSource: 'manuel',
        websiteConfidence: 1,
      })
      .run();
    const requested: string[] = [];
    const fetchPage = async (url: string) => {
      requested.push(url);
      if (url === 'https://example.com')
        return page(
          'https://www.example.com/',
          '<html><body><a href="/nous-rejoindre">Nous rejoindre</a><p>Accueil.</p></body></html>',
        );
      if (url === 'https://www.example.com/nous-rejoindre')
        return page(url, '<html><body><p>Nous cherchons un développeur Rust backend.</p></body></html>');
      return null;
    };
    const result = await crawlCompany(db, '000000002', { fetchPage, robotsAllowed: async () => true });
    expect(result.careersUrl).toBe('https://www.example.com/nous-rejoindre');
    expect(result.detections.find((d) => d.slug === 'rust')?.confidence).toBe(0.7);
    expect(
      requested.every((u) => u === 'https://example.com' || u.startsWith('https://www.example.com/')),
    ).toBe(true);
    expect(db.select().from(companies).get()?.website).toBe('https://example.com');
  });
});

describe('crawl deadline', () => {
  it('stops fetching more pages once the deadline is passed and still persists the analysis', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    db.insert(companies)
      .values({
        siren: '000000003',
        name: 'Slow',
        legalName: 'SLOW',
        nafCode: '62.01Z',
        siretLocal: 'c',
        latitude: 43.62,
        longitude: 7.04,
        website: 'https://slow.example',
        websiteSource: 'manuel',
        websiteConfidence: 1,
      })
      .run();
    const requested: string[] = [];
    const fetchPage = async (url: string) => {
      requested.push(url);
      await new Promise((r) => setTimeout(r, 50));
      return page(url, '<html><body><p>Nous utilisons le framework Vue.</p></body></html>');
    };
    const proposed = selectPages('https://slow.example', [], []).length;
    const result = await crawlCompany(db, '000000003', {
      fetchPage,
      robotsAllowed: async () => true,
      deadlineMs: 120,
    });
    expect(requested.length).toBeGreaterThanOrEqual(1);
    expect(requested.length).toBeLessThan(proposed);
    expect(result.detections.map((d) => d.slug)).toContain('vue');
    expect(db.select().from(companies).get()?.lastCrawledAt).toBeTruthy();
    expect(
      db
        .select()
        .from(companyTech)
        .all()
        .map((t) => t.tagSlug),
    ).toEqual(['vue']);
  });
});

describe('external redirects', () => {
  it('rejects a site that redirects to a social network or aggregator', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    db.insert(companies)
      .values({
        siren: '000000004',
        name: 'Social',
        legalName: 'SOCIAL',
        nafCode: '62.01Z',
        siretLocal: 'd',
        latitude: 43.62,
        longitude: 7.04,
        website: 'https://social.example',
        websiteSource: 'devinette',
        websiteConfidence: 0.6,
      })
      .run();
    const fetchPage = async () =>
      page('https://www.facebook.com/x', '<html><body><p>Nous utilisons le framework Vue.</p></body></html>');
    await expect(
      crawlCompany(db, '000000004', { fetchPage, robotsAllowed: async () => true }),
    ).rejects.toThrow('Le site redirige vers facebook.com, ignoré');
    expect(db.select().from(companies).get()?.lastCrawledAt).toBeNull();
    expect(db.select().from(companyTech).all()).toEqual([]);
  });
});

describe('career detection by pathname', () => {
  it('ignores career words that only appear in the hostname', () => {
    const result = analyzeSite('https://joinly.fr', [
      page(
        'https://joinly.fr',
        '<html><body><a href="/">Accueil</a><a href="/mentions-legales">Mentions</a><p>Bienvenue.</p></body></html>',
      ),
      page('https://joinly.fr/mentions-legales', '<html><body><p>Nous utilisons React.</p></body></html>'),
    ]);
    expect(result.careersUrl).toBeNull();
    expect(result.detections.find((d) => d.slug === 'react')?.confidence).toBe(0.5);
  });
});

describe('balanced probing', () => {
  it('interleaves path families when nothing is known about the site', () => {
    const pages = selectPages('https://example.com', [], []);
    expect(pages).toHaveLength(12);
    expect(pages[0]).toBe('https://example.com');
    expect(pages.some((p) => ['/about', '/about-us', '/a-propos'].some((s) => p.endsWith(s)))).toBe(true);
    expect(
      pages.some((p) => ['/technologies', '/technologie', '/tech', '/stack'].some((s) => p.endsWith(s))),
    ).toBe(true);
  });
});
