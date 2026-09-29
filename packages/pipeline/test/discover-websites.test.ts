import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { companies, createDb, migrateAndSeed } from '@novi/db';
import { describe, expect, it } from 'vitest';
import { matchOsmBusiness, normalizeWebsite, parseOverpass } from '../src/sources/overpass';
import {
  candidateDomains,
  discoverWebsites,
  PARKED_MARKERS,
  verifyHomepage,
} from '../src/steps/discover-websites';

const overpass = parseOverpass(
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/overpass.json'), 'utf8')),
);
const html = readFileSync(join(import.meta.dirname, 'fixtures/site-cliken.html'), 'utf8');

describe('overpass', () => {
  it('parses nodes and ways with centers', () => {
    expect(overpass).toHaveLength(3);
    expect(overpass[1]).toMatchObject({
      name: 'Nice Tech Studio',
      latitude: 43.7103,
      longitude: 7.2621,
      website: 'https://nicetechstudio.fr',
    });
  });
  it('normalizes websites to https URLs', () => {
    expect(normalizeWebsite('nicetechstudio.fr')).toBe('https://nicetechstudio.fr');
    expect(normalizeWebsite('http://x.fr/')).toBe('http://x.fr/');
    expect(normalizeWebsite('')).toBeNull();
  });
  it('matches by name within 300 m', () => {
    const company = {
      name: 'Cliken Web',
      legalName: 'CLIKEN WEB PRO',
      tradeNames: ['CLIKEN WEB'],
      latitude: 43.6197,
      longitude: 7.0373,
    };
    expect(matchOsmBusiness(company, overpass)?.website).toBe('https://www.cliken-web.com');
    expect(matchOsmBusiness({ ...company, latitude: 43.9, longitude: 7.3 }, overpass)).toBeNull();
    expect(
      matchOsmBusiness({ ...company, name: 'Autre', legalName: 'AUTRE', tradeNames: [] }, overpass),
    ).toBeNull();
  });
});

describe('candidateDomains', () => {
  it('slugifies trade names then legal name across TLDs', () => {
    const domains = candidateDomains({
      name: 'Cliken Web',
      legalName: 'CLIKEN WEB PRO',
      tradeNames: ['CLIKEN WEB'],
    });
    expect(domains.slice(0, 5)).toEqual([
      'https://clikenweb.com',
      'https://clikenweb.fr',
      'https://clikenweb.io',
      'https://clikenweb.eu',
      'https://clikenweb.tech',
    ]);
    expect(domains).toContain('https://clikenwebpro.com');
    expect(new Set(domains).size).toBe(domains.length);
  });
  it('also tries the hyphenated slug after the plain one for multi-word names', () => {
    const domains = candidateDomains({ name: 'Ava6 Mediterranee', legalName: 'AVAMED', tradeNames: [] });
    const bases = [...new Set(domains.map((d) => d.replace(/^https:\/\//, '').replace(/\.[a-z]+$/, '')))];
    expect(bases).toEqual(['ava6mediterranee', 'ava6-mediterranee', 'avamed']);
    expect(domains).toContain('https://ava6mediterranee.com');
    expect(domains).toContain('https://ava6-mediterranee.com');
    expect(domains).toContain('https://avamed.com');
    expect(new Set(domains).size).toBe(domains.length);
  });
});

describe('verifyHomepage', () => {
  it('accepts when a significant word of the name is in the title or description', () => {
    expect(verifyHomepage(html, { name: 'Cliken Web', legalName: 'CLIKEN WEB PRO', tradeNames: [] })).toBe(
      true,
    );
    expect(verifyHomepage(html, { name: 'Boulangerie Dupont', legalName: 'DUPONT', tradeNames: [] })).toBe(
      false,
    );
  });
  it('rejects parked domains', () => {
    const ace = { name: 'Ace Software', legalName: 'ACE SOFTWARE', tradeNames: [] };
    expect(verifyHomepage('<title>acesoftware.com - Ce site web est à vendre !</title>', ace)).toBe(false);
    expect(verifyHomepage('<title>Buy this domain - acesoftware.com</title>', ace)).toBe(false);
    expect(verifyHomepage('<title>Ace Software - editeur de logiciels a Sophia Antipolis</title>', ace)).toBe(
      true,
    );
    const inotekk = { name: 'Inotekk', legalName: 'INOTEKK', tradeNames: [] };
    expect(verifyHomepage('<title>Inotekk.com — This domain is parked</title>', inotekk)).toBe(false);
    expect(verifyHomepage('<title>Logiciels sur-mesure, Data & IA | Inotekk</title>', inotekk)).toBe(true);
    expect(PARKED_MARKERS).toContain('a vendre');
  });
});

describe('discoverWebsites', () => {
  it('uses offers first, then OSM, then domain guessing, and never overwrites manual', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    db.insert(companies)
      .values([
        {
          siren: '000000001',
          name: 'Cliken Web',
          legalName: 'CLIKEN WEB PRO',
          tradeNames: ['CLIKEN WEB'],
          nafCode: '62.01Z',
          siretLocal: 'a',
          latitude: 43.6197,
          longitude: 7.0373,
        },
        {
          siren: '000000002',
          name: 'Nice Tech Studio',
          legalName: 'NICE TECH STUDIO',
          nafCode: '62.01Z',
          siretLocal: 'b',
          latitude: 43.7102,
          longitude: 7.262,
        },
        {
          siren: '000000003',
          name: 'Guessable',
          legalName: 'GUESSABLE',
          nafCode: '62.01Z',
          siretLocal: 'c',
          latitude: 43.5,
          longitude: 7.0,
        },
        {
          siren: '000000004',
          name: 'Manual',
          legalName: 'MANUAL',
          nafCode: '62.01Z',
          siretLocal: 'd',
          latitude: 43.5,
          longitude: 7.0,
          website: 'https://manual.example',
          websiteSource: 'manuel',
          websiteConfidence: 1,
        },
      ])
      .run();
    const fetched: string[] = [];
    await discoverWebsites(db, {
      force: true,
      offerUrls: new Map([['000000001', 'https://www.cliken-web.com']]),
      osm: overpass,
      fetchHomepage: async (url) => {
        fetched.push(url);
        return url === 'https://guessable.com' ? '<title>Guessable — accueil</title>' : null;
      },
    });
    const rows = Object.fromEntries(
      db
        .select()
        .from(companies)
        .all()
        .map((c) => [c.siren, c]),
    );
    expect(rows['000000001']).toMatchObject({
      website: 'https://www.cliken-web.com',
      websiteSource: 'offre',
      websiteConfidence: 0.9,
    });
    expect(rows['000000002']).toMatchObject({
      website: 'https://nicetechstudio.fr',
      websiteSource: 'osm',
      websiteConfidence: 0.8,
    });
    expect(rows['000000003']).toMatchObject({
      website: 'https://guessable.com',
      websiteSource: 'devinette',
      websiteConfidence: 0.6,
    });
    expect(rows['000000004']).toMatchObject({ website: 'https://manual.example', websiteSource: 'manuel' });
    expect(fetched).not.toContain('https://manual.com');
  });

  it('continues with offers and domain guessing when Overpass is unavailable', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    db.insert(companies)
      .values([
        {
          siren: '000000001',
          name: 'Cliken Web',
          legalName: 'CLIKEN WEB PRO',
          tradeNames: ['CLIKEN WEB'],
          nafCode: '62.01Z',
          siretLocal: 'a',
          latitude: 43.6197,
          longitude: 7.0373,
        },
        {
          siren: '000000003',
          name: 'Guessable',
          legalName: 'GUESSABLE',
          nafCode: '62.01Z',
          siretLocal: 'c',
          latitude: 43.5,
          longitude: 7.0,
        },
      ])
      .run();
    const fetched: string[] = [];
    const result = await discoverWebsites(db, {
      force: true,
      offerUrls: new Map([['000000001', 'https://www.cliken-web.com']]),
      osm: undefined,
      fetchOsm: async () => {
        throw new Error('HTTP 504 sur overpass');
      },
      fetchHomepage: async (url) => {
        fetched.push(url);
        return url === 'https://guessable.com' ? '<title>Guessable — accueil</title>' : null;
      },
    });
    expect(result.stats.errors).toBe(1);
    expect(result.stats.osmUnavailable).toBe(1);
    expect(result.stats.processed).toBe(2);
    expect(result.errors).toEqual([{ message: 'HTTP 504 sur overpass' }]);
    expect(fetched).toContain('https://guessable.com');
    const rows = Object.fromEntries(
      db
        .select()
        .from(companies)
        .all()
        .map((c) => [c.siren, c]),
    );
    expect(rows['000000001']).toMatchObject({
      website: 'https://www.cliken-web.com',
      websiteSource: 'offre',
    });
    expect(rows['000000003']).toMatchObject({ website: 'https://guessable.com', websiteSource: 'devinette' });
  });
});
