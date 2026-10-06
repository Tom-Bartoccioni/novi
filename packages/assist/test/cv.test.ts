import { loadTechTags } from '@novi/core';
import { describe, expect, it } from 'vitest';
import { analyzeCv, CV_TECH_CONFIDENCE, detectIdentityHints } from '../src/cv';
import { anonymize } from '../src/privacy';

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
  it('strips closing punctuation from generic URLs', () => {
    expect(detectIdentityHints('Site : https://jp.dev/x»').links).toEqual(['https://jp.dev/x']);
  });
  it('detects case variants and subdomains of profile sites', () => {
    expect(detectIdentityHints('LinkedIn.com/in/x').links).toEqual(['https://LinkedIn.com/in/x']);
    expect(detectIdentityHints('fr.linkedin.com/in/x').links).toEqual(['https://fr.linkedin.com/in/x']);
  });
  it('deduplicates links written with or without scheme, www and trailing slash', () => {
    const text = 'https://github.com/jp | github.com/jp | www.github.com/jp/';
    expect(detectIdentityHints(text).links).toEqual(['https://github.com/jp']);
  });
  it('accepts lowercase particles inside a name', () => {
    expect(detectIdentityHints('Jean de La Fontaine').nameCandidates).toEqual(['Jean de La Fontaine']);
  });
  it('rejects job titles such as « Lead Dev Backend »', () => {
    expect(detectIdentityHints('Lead Dev Backend\nFull-Stack Developer').nameCandidates).toEqual([]);
  });
  it('caps name candidates at three', () => {
    const text = 'Anne Martin\nPaul Durand\nLuc Petit\nMarc Leroy';
    expect(detectIdentityHints(text).nameCandidates).toEqual(['Anne Martin', 'Paul Durand', 'Luc Petit']);
  });
  it('returns no candidate when the CV has no detectable name', () => {
    expect(detectIdentityHints('contact: a@b.fr\n2020 : stage').nameCandidates).toEqual([]);
  });
});

describe('chained detection and anonymisation', () => {
  it('leaves no link handle once detected links are masked', () => {
    const text = 'Jean Dupont\ngithub.com/jpdupont | https://www.linkedin.com/in/jpdupont';
    const out = anonymize(text, { links: detectIdentityHints(text).links, revealFirstName: false });
    expect(out).not.toContain('jpdupont');
  });
});
