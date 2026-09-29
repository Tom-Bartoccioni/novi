import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTechTags } from '@novi/core';
import { companies, companyTech, createDb, migrateAndSeed, signals } from '@novi/db';
import { describe, expect, it, vi } from 'vitest';
import { languageToSlug, reposSchema, summarizeRepos } from '../src/sources/github';
import { enrichGithub } from '../src/steps/enrich-github';

const repos = reposSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/github-repos.json'), 'utf8')),
);
const tags = loadTechTags();
const NOW = new Date('2026-09-29T00:00:00Z');

describe('languageToSlug', () => {
  it('maps GitHub language names to tag slugs', () => {
    expect(languageToSlug('TypeScript', tags)).toBe('typescript');
    expect(languageToSlug('Go', tags)).toBe('go');
    expect(languageToSlug('C#', tags)).toBe('csharp');
    expect(languageToSlug('Jupyter Notebook', tags)).toBeNull();
  });
});

describe('summarizeRepos', () => {
  it('ignores forks and archived repos, counts languages, finds last push', () => {
    const s = summarizeRepos(repos, tags, NOW);
    expect(s.detections.map((d) => d.slug).sort()).toEqual(['go', 'typescript']);
    expect(s.detections.find((d) => d.slug === 'typescript')?.evidence).toBe('1 dépôt public : platform');
    expect(s.lastPushAt).toBe('2026-09-10T10:00:00Z');
    expect(s.active).toBe(true);
    expect(s.publicRepos).toBe(3);
  });
  it('is inactive when the last push is older than 6 months', () => {
    const s = summarizeRepos(repos, tags, new Date('2027-06-01T00:00:00Z'));
    expect(s.active).toBe(false);
  });
});

describe('enrichGithub', () => {
  it('writes github detections and the github_active signal', async () => {
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
        githubOrg: 'cliken-web',
      })
      .run();
    const result = await enrichGithub(db, { fetchRepos: async () => repos, now: NOW });
    expect(result.stats).toMatchObject({ processed: 1, updated: 1 });
    const techs = db.select().from(companyTech).all();
    expect(techs.map((t) => `${t.source}:${t.tagSlug}:${t.confidence}`).sort()).toEqual([
      'github:go:0.8',
      'github:typescript:0.8',
    ]);
    expect(db.select().from(signals).all()).toMatchObject([{ kind: 'github_active', value: 3 }]);
  });
  it('warns when --siren targets a company without a known GitHub organisation', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    db.insert(companies)
      .values({
        siren: '000000002',
        name: 'No Org',
        legalName: 'NO ORG',
        nafCode: '62.01Z',
        siretLocal: 'b',
        latitude: 43.62,
        longitude: 7.04,
      })
      .run();
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await enrichGithub(db, { siren: '000000002', fetchRepos: async () => repos, now: NOW });
      expect(result.stats.processed).toBe(0);
      expect(warned.mock.calls.flat().join('\n')).toContain("000000002 : pas d'organisation GitHub connue");
    } finally {
      warned.mockRestore();
    }
  });
});
