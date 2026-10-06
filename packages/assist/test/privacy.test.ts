import { describe, expect, it } from 'vitest';
import { anonymize, type Identity, restore } from '../src/privacy';

const identity: Identity = {
  firstName: 'Jean-Pierre',
  lastName: 'Dupont',
  email: 'jp.dupont@example.com',
  phone: '06 12 34 56 78',
  postalAddress: '12 rue des Lilas, 06000 Nice',
  links: ['https://www.linkedin.com/in/jpdupont', 'https://github.com/jpdupont'],
  revealFirstName: false,
};

describe('anonymize', () => {
  it('replaces every known value by its token, case and accent insensitive', () => {
    const text =
      'JEAN-PIERRE DUPONT\nDéveloppeur\njp.dupont@example.com · 06 12 34 56 78\n12 rue des Lilas, 06000 Nice\nhttps://github.com/jpdupont';
    const out = anonymize(text, identity);
    expect(out).toBe('[PRENOM] [NOM]\nDéveloppeur\n[EMAIL] · [TELEPHONE]\n[ADRESSE]\n[LIEN_2]');
  });
  it('matches accented variants of the declared value', () => {
    const out = anonymize('Signé : Jérôme Lefèvre', {
      ...identity,
      firstName: 'Jerome',
      lastName: 'Lefevre',
    });
    expect(out).toBe('Signé : [PRENOM] [NOM]');
  });
  it('keeps the first name when revealFirstName is set', () => {
    expect(anonymize('Jean-Pierre Dupont', { ...identity, revealFirstName: true })).toBe('Jean-Pierre [NOM]');
  });
  it('does not touch words that merely contain the value', () => {
    expect(anonymize('Dupontel et Dupont', identity)).toBe('Dupontel et [NOM]');
  });
  it('ignores values shorter than three characters', () => {
    expect(anonymize('Li et Lili', { ...identity, lastName: 'Li' })).toBe('Li et Lili');
  });
  it('catches undeclared emails and French phone numbers', () => {
    const out = anonymize('Contact : autre@mail.fr ou +33 6 98 76 54 32 ou 04.93.00.11.22', {
      ...identity,
      email: null,
      phone: null,
    });
    expect(out).toBe('Contact : [EMAIL] ou [TELEPHONE] ou [TELEPHONE]');
  });
  it('does not mask a phone-like run glued to other digits', () => {
    const out = anonymize('Réf 1006 12 34 56 78 et 06 12 34 56 78', { ...identity, phone: null });
    expect(out).toBe('Réf 1006 12 34 56 78 et [TELEPHONE]');
  });
  it('catches international phone prefixes', () => {
    const out = anonymize('Tél. +33 (0)6 12 34 56 78 ou 0033 6 12 34 56 78', { ...identity, phone: null });
    expect(out).toBe('Tél. [TELEPHONE] ou [TELEPHONE]');
  });
  it('matches decomposed (NFD) text and values', () => {
    const nfdText = 'Jérôme Dupont'.normalize('NFD');
    expect(anonymize(nfdText, { ...identity, firstName: 'Jérôme' })).toBe('[PRENOM] [NOM]');
    const nfdValue = 'Jérôme'.normalize('NFD');
    expect(anonymize('Jérôme Dupont', { ...identity, firstName: nfdValue })).toBe('[PRENOM] [NOM]');
  });
  it('masks a value written between brackets, brackets included', () => {
    expect(anonymize('(Dupont) et [Dupont]', identity)).not.toContain('Dupont');
    const out = anonymize('voir [Dupont] ici', identity);
    expect(out).toBe('voir [NOM] ici');
    // Les crochets sont perdus à la restauration, limite assumée.
    expect(restore(out, identity)).toBe('voir Dupont ici');
  });
  it('matches a declared value whose spaces became a line break', () => {
    expect(anonymize('12 rue des Lilas,\n06000 Nice', identity)).toBe('[ADRESSE]');
  });
  it('protects tokens already present in the source text', () => {
    const out = anonymize('Le texte contient [NOM] littéralement, signé Dupont', identity);
    expect(out).toBe('Le texte contient [[NOM]] littéralement, signé [NOM]');
  });
  it('does not match inside an existing token', () => {
    expect(anonymize('[NOM] et Nom', { ...identity, lastName: 'Nom' })).toBe('[[NOM]] et [NOM]');
  });
});

describe('restore', () => {
  it('round-trips anonymize for every field', () => {
    const text =
      'Jean-Pierre Dupont, jp.dupont@example.com, 06 12 34 56 78, 12 rue des Lilas, 06000 Nice, https://www.linkedin.com/in/jpdupont';
    expect(restore(anonymize(text, identity), identity)).toBe(text);
  });
  it('fills tokens the model placed itself', () => {
    expect(restore('Cordialement,\n[PRENOM] [NOM]\n[TELEPHONE]', identity)).toBe(
      'Cordialement,\nJean-Pierre Dupont\n06 12 34 56 78',
    );
  });
  it('drops tokens without a value and tidies the spaces', () => {
    const out = restore('Signé [PRENOM] [NOM] ([LIEN_3])', {
      ...identity,
      firstName: null,
      links: [],
    });
    expect(out).toBe('Signé Dupont ()');
  });
  it('drops an empty token at the start or end of a line with its space', () => {
    expect(restore('Bien à vous,\n[PRENOM] [NOM]\n[NOM] [PRENOM]', { ...identity, firstName: null })).toBe(
      'Bien à vous,\nDupont\nDupont',
    );
  });
  it('treats tabs like spaces around an empty token', () => {
    expect(restore('Nom :\t[PRENOM]\t[NOM]', { ...identity, firstName: null })).toBe('Nom :\tDupont');
  });
  it('keeps the spacing of the model output elsewhere', () => {
    expect(restore('  - item\n  - [NOM]  [EMAIL]', identity)).toBe(
      '  - item\n  - Dupont  jp.dupont@example.com',
    );
  });
  it('restores protected literal tokens', () => {
    expect(restore('[[NOM]] et [NOM]', identity)).toBe('[NOM] et Dupont');
  });
});
