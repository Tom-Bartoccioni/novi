import { describe, expect, it } from 'vitest';
import { buildLetterPrompt, LETTER_MAX_TOKENS, type LetterInput } from '../src/letter';

const base: LetterInput = {
  profile: { homeLabel: 'Nice', skills: ['typescript', 'react'] },
  cvText: '[PRENOM] [NOM]\nDéveloppeur TypeScript',
  company: {
    name: 'Cliken Web',
    city: 'Valbonne',
    headcountLabel: '20 à 49 salariés',
    description: 'Agence web',
    techs: [
      { label: 'React', source: 'site' },
      { label: 'PostgreSQL', source: 'offre' },
    ],
    careersUrl: 'https://cliken.example/jobs',
    website: 'https://cliken.example',
  },
  revealFirstName: false,
};

describe('buildLetterPrompt', () => {
  it('asks for a spontaneous application without an offer', () => {
    const { system, prompt } = buildLetterPrompt(base);
    expect(system).toMatch(/une page/i);
    expect(system).toMatch(/\[NOM\]/);
    expect(system).toMatch(/n'invente/i);
    expect(prompt).toContain('# CV du candidat');
    expect(prompt).toContain('Cliken Web');
    expect(prompt).toContain('React (site)');
    expect(prompt).toMatch(/candidature spontanée/i);
    expect(prompt).not.toContain('# Offre');
    expect(prompt).not.toContain('# Consigne');
  });
  it('includes the offer and the instruction when provided', () => {
    const { prompt } = buildLetterPrompt({
      ...base,
      offer: { title: 'Dev React', contractType: 'CDI', description: 'Mission React', city: 'Nice' },
      instruction: 'Insister sur Rust',
    });
    expect(prompt).toContain('# Offre');
    expect(prompt).toContain('Dev React');
    expect(prompt).toContain('CDI');
    expect(prompt).toContain('# Consigne particulière');
    expect(prompt).toContain('Insister sur Rust');
    expect(prompt).toMatch(/pour cette offre/i);
  });
  it('omits empty company fields', () => {
    const { prompt } = buildLetterPrompt({
      ...base,
      company: { ...base.company, description: null, careersUrl: null, website: null, techs: [] },
    });
    expect(prompt).not.toContain('Description');
    expect(prompt).not.toContain('Technologies');
    expect(prompt).not.toContain('Page carrière');
  });
  it('tells the model the first name is real when revealed', () => {
    expect(buildLetterPrompt({ ...base, revealFirstName: true }).system).toMatch(/prénom/i);
    expect(buildLetterPrompt(base).system).not.toMatch(/le prénom du candidat est en clair/i);
  });
  it('exposes a short max tokens budget', () => {
    expect(LETTER_MAX_TOKENS).toBe(2048);
  });
});
