import { describe, expect, it } from 'vitest';
import {
  HEADCOUNT_LABELS,
  loadCrawlPaths,
  loadEsnKeywords,
  loadIngestConfig,
  loadTechTags,
} from '../src/config';

describe('config loaders', () => {
  it('ingest config has NAF codes, headcount ranges and ROME codes', () => {
    const cfg = loadIngestConfig();
    expect(cfg.nafCodes).toContain('62.01Z');
    expect(cfg.nafLabels['62.01Z']).toBe('Programmation informatique');
    expect(cfg.headcountRanges).toEqual(['03', '11', '12', '21', '22']);
    expect(cfg.romeCodes).toContain('M1805');
  });
  it('tech tags are unique by slug and every alias is lowercase', () => {
    const tags = loadTechTags();
    expect(tags.length).toBeGreaterThan(100);
    const slugs = new Set(tags.map((t) => t.slug));
    expect(slugs.size).toBe(tags.length);
    for (const t of tags) for (const a of t.aliases) expect(a).toBe(a.toLowerCase());
  });
  it('ambiguous tags require context', () => {
    const go = loadTechTags().find((t) => t.slug === 'go');
    expect(go?.contextRequired?.length).toBeGreaterThan(0);
  });
  it('esn keywords and crawl paths load', () => {
    expect(loadEsnKeywords()).toContain('portage salarial');
    expect(loadCrawlPaths()).toContain('/carrieres');
  });
  it('headcount labels cover INSEE codes', () => {
    expect(HEADCOUNT_LABELS['12']).toBe('20 à 49 salariés');
    expect(HEADCOUNT_LABELS.NN).toBe('Non renseigné');
  });
});
