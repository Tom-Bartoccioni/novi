import { describe, expect, it } from 'vitest';
import { loadEsnKeywords, loadTechTags } from '../src/config';
import { detectEsn, detectFingerprints, detectTechs, mergeDetections, splitSentences } from '../src/detect';

const tags = loadTechTags();

describe('splitSentences', () => {
  it('splits on punctuation and newlines and trims', () => {
    expect(splitSentences('Nous utilisons React. Et Python!\nAussi Go.')).toEqual([
      'Nous utilisons React.',
      'Et Python!',
      'Aussi Go.',
    ]);
  });
});

describe('detectTechs', () => {
  it('finds plain aliases with word boundaries', () => {
    const found = detectTechs('Stack : React, Node.js et PostgreSQL.', tags, 0.7);
    const slugs = found.map((d) => d.slug);
    expect(slugs).toContain('react');
    expect(slugs).toContain('nodejs');
    expect(slugs).toContain('postgresql');
    expect(found.find((d) => d.slug === 'react')?.confidence).toBe(0.7);
    expect(found.find((d) => d.slug === 'react')?.evidence).toBe('Stack : React, Node.js et PostgreSQL.');
  });
  it('does not match "reactive" for react', () => {
    expect(detectTechs('Une équipe réactive et proactive.', tags, 0.5)).toEqual([]);
  });
  it('requires context for ambiguous names', () => {
    expect(detectTechs('On y go pour la réunion.', tags, 0.5).map((d) => d.slug)).not.toContain('go');
    expect(detectTechs('Développeur Go confirmé.', tags, 0.5).map((d) => d.slug)).toContain('go');
    expect(detectTechs('Le langage R pour la statistique.', tags, 0.5).map((d) => d.slug)).toContain('r');
    expect(detectTechs('Vitamine C et repos.', tags, 0.5).map((d) => d.slug)).not.toContain('c');
    expect(detectTechs('Développement C/C++ embarqué.', tags, 0.5).map((d) => d.slug)).toContain('c');
  });
  it('is case-insensitive and accent-insensitive on aliases', () => {
    const slugs = detectTechs('CYBERSÉCURITÉ et cybersecurite.', tags, 0.5).map((d) => d.slug);
    expect(slugs).toContain('cybersecurity');
  });
  it('dedupes by slug keeping the first evidence', () => {
    const found = detectTechs('React ici. React là.', tags, 0.5);
    expect(found.filter((d) => d.slug === 'react')).toHaveLength(1);
  });
  it('does not match .net inside e-mail addresses or domains', () => {
    expect(
      detectTechs('Contactez-nous sur contact@monentreprise.net ou www.exemple.net', tags, 0.5).map(
        (d) => d.slug,
      ),
    ).not.toContain('dotnet');
    expect(detectTechs('Développeur .NET Core et C#/.NET', tags, 0.5).map((d) => d.slug)).toContain('dotnet');
  });
  it('does not tag C when the text says C++ or C#', () => {
    const cpp = detectTechs('Développeur C++ senior', tags, 0.5).map((d) => d.slug);
    expect(cpp).toContain('cpp');
    expect(cpp).not.toContain('c');
    const cs = detectTechs('Développeur C#/.NET', tags, 0.5).map((d) => d.slug);
    expect(cs).toContain('csharp');
    expect(cs).not.toContain('c');
  });
  it('ignores common French words that used to be aliases', () => {
    expect(
      detectTechs("J'ai rejoint l'équipe. J’ai adoré la vue sur la mer.", tags, 0.5).map((d) => d.slug),
    ).toEqual([]);
    expect(
      detectTechs('Paiement en 3 fois, conteneurs maritimes, temps réel.', tags, 0.5).map((d) => d.slug),
    ).toEqual([]);
  });
  it('detects Node in a stack list next to React', () => {
    expect(detectTechs('Stack : React / Node / Postgres', tags, 0.5).map((d) => d.slug)).toContain('nodejs');
    expect(detectTechs('Framework Vue 3 avec Pinia', tags, 0.5).map((d) => d.slug)).toContain('vue');
  });
});

describe('detectFingerprints', () => {
  it('detects Next.js from markup and WordPress from paths', () => {
    const html =
      '<html><head><script src="/_next/static/chunks/main.js"></script></head><body><div id="__next"></div></body></html>';
    const found = detectFingerprints(html, {}, tags);
    expect(found.map((d) => d.slug)).toContain('nextjs');
    expect(found.find((d) => d.slug === 'nextjs')?.confidence).toBe(0.9);
    const wp = detectFingerprints('<link href="/wp-content/themes/x.css">', {}, tags);
    expect(wp.map((d) => d.slug)).toContain('wordpress');
  });
  it('detects from headers', () => {
    const found = detectFingerprints(
      '<html></html>',
      { server: 'cloudflare', 'x-powered-by': 'Express' },
      tags,
    );
    const slugs = found.map((d) => d.slug);
    expect(slugs).toContain('cloudflare');
    expect(slugs).toContain('nodejs');
  });
});

describe('mergeDetections', () => {
  it('keeps the best confidence per slug', () => {
    const merged = mergeDetections(
      [{ slug: 'react', evidence: 'a', confidence: 0.5 }],
      [
        { slug: 'react', evidence: 'b', confidence: 0.9 },
        { slug: 'vue', evidence: 'c', confidence: 0.5 },
      ],
    );
    expect(merged).toEqual([
      { slug: 'react', evidence: 'b', confidence: 0.9 },
      { slug: 'vue', evidence: 'c', confidence: 0.5 },
    ]);
  });
});

describe('detectEsn', () => {
  const keywords = loadEsnKeywords();
  it('returns the sentence containing an ESN keyword', () => {
    expect(detectEsn('Nous sommes une ESN à taille humaine. Rejoignez-nous.', keywords)).toBe(
      'Nous sommes une ESN à taille humaine.',
    );
  });
  it('returns null otherwise', () => {
    expect(detectEsn('Nous éditons un logiciel de gestion.', keywords)).toBeNull();
  });
});
