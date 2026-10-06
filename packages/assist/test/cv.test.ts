import { loadTechTags } from '@novi/core';
import { describe, expect, it } from 'vitest';
import { analyzeCv, CV_TECH_CONFIDENCE, detectIdentityHints } from '../src/cv';

const tags = loadTechTags();

const CV = `Jean-Pierre Dupont
Développeur full stack
jp.dupont@example.com | 06 12 34 56 78 | https://www.linkedin.com/in/jpdupont | github.com/jpdupont

Expérience Professionnelle
2022-2026 : Développeur TypeScript, React et Node.js chez Acme (PostgreSQL, Docker)
Formation
Master informatique`;

describe('analyzeCv', () => {
  it('detects technologies with the CV confidence', () => {
    const { techs } = analyzeCv(CV, tags);
    const slugs = techs.map((t) => t.slug);
    expect(slugs).toEqual(expect.arrayContaining(['typescript', 'react', 'nodejs', 'postgresql', 'docker']));
    expect(techs.every((t) => t.confidence === CV_TECH_CONFIDENCE)).toBe(true);
  });
});

describe('detectIdentityHints', () => {
  it('finds email, phone and links', () => {
    const hints = detectIdentityHints(CV);
    expect(hints.email).toBe('jp.dupont@example.com');
    expect(hints.phone).toBe('06 12 34 56 78');
    expect(hints.links).toEqual(['https://www.linkedin.com/in/jpdupont', 'https://github.com/jpdupont']);
  });
  it('proposes capitalised short lines as name candidates, skipping CV headings', () => {
    expect(detectIdentityHints(CV).nameCandidates).toEqual(['Jean-Pierre Dupont']);
  });
  it('returns empty hints on an empty text', () => {
    expect(detectIdentityHints('')).toEqual({
      email: undefined,
      phone: undefined,
      links: [],
      nameCandidates: [],
    });
  });
  it('skips headings like « Expérience Professionnelle » even without a real name', () => {
    expect(
      detectIdentityHints('Expérience Professionnelle\nCentres Intérêts\nMarie Curie').nameCandidates,
    ).toEqual(['Marie Curie']);
  });
});
