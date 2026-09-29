import { describe, expect, it } from 'vitest';
import { normalizeCompanyName, significantWords, slugify } from '../src/normalize';

describe('normalizeCompanyName', () => {
  it('lowercases, strips accents and punctuation', () => {
    expect(normalizeCompanyName('Société Générale-Informatique !')).toBe('societe generale informatique');
  });
  it('removes legal forms wherever they appear', () => {
    expect(normalizeCompanyName('SAS CLIKEN WEB')).toBe('cliken web');
    expect(normalizeCompanyName('Cliken Web SAS')).toBe('cliken web');
    expect(normalizeCompanyName('S.A.R.L. Dupont')).toBe('dupont');
    expect(normalizeCompanyName('WeTech SASU')).toBe('wetech');
  });
  it('collapses whitespace', () => {
    expect(normalizeCompanyName('  Tech   Nice  ')).toBe('tech nice');
  });
  it('keeps digits', () => {
    expect(normalizeCompanyName('Studio 42')).toBe('studio 42');
  });
});

describe('slugify', () => {
  it('produces a domain-safe slug', () => {
    expect(slugify('Cliken Web')).toBe('clikenweb');
    expect(slugify('Émile & Co')).toBe('emileco');
  });
});

describe('significantWords', () => {
  it('drops stop words and short words', () => {
    expect(significantWords('Les Ateliers du Code')).toEqual(['ateliers', 'code']);
    expect(significantWords('WEB PRO')).toEqual([]);
  });
  it('drops generic business and tech words', () => {
    expect(significantWords('ACE SOFTWARE')).toEqual([]);
    expect(significantWords('AVA6 MEDITERRANEE')).toEqual(['ava6']);
    expect(significantWords('Riviera Cloud Systems')).toEqual([]);
  });
});
