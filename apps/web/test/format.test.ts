import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatRelativeHours, splitFullName } from '@/lib/format';

describe('formatRelativeHours', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  it('compte en minutes sous une heure', () => {
    expect(formatRelativeHours('2026-10-06T12:00:00Z', now)).toBe('il y a 0 min');
    expect(formatRelativeHours('2026-10-06T11:15:30Z', now)).toBe('il y a 44 min');
    expect(formatRelativeHours('2026-10-06T11:00:01Z', now)).toBe('il y a 59 min');
  });
  it('compte en heures sous 48 h', () => {
    expect(formatRelativeHours('2026-10-06T11:00:00Z', now)).toBe('il y a 1 h');
    expect(formatRelativeHours('2026-10-06T08:59:00Z', now)).toBe('il y a 3 h');
    expect(formatRelativeHours('2026-10-04T12:00:01Z', now)).toBe('il y a 47 h');
  });
  it('affiche la date au-delà de 48 h, pour une date future ou invalide', () => {
    expect(formatRelativeHours('2026-10-04T12:00:00Z', now)).toBe(formatDate('2026-10-04T12:00:00Z'));
    expect(formatRelativeHours('2026-10-07T12:00:00Z', now)).toBe(formatDate('2026-10-07T12:00:00Z'));
    expect(formatRelativeHours('pas une date', now)).toBe('pas une date');
    expect(formatRelativeHours(null, now)).toBe('—');
  });
});

describe('formatDateTime', () => {
  it("donne date et heure courtes à l'heure locale", () => {
    // Sans fuseau, la chaîne est lue à l'heure locale : le résultat ne dépend pas du fuseau de la machine.
    expect(formatDateTime('2026-10-06T08:01:00')).toBe('06/10/2026 08:01');
  });
  it('gère les valeurs absentes ou invalides', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('pas une date')).toBe('pas une date');
  });
});

describe('splitFullName', () => {
  it('prend le premier mot comme prénom par défaut', () => {
    expect(splitFullName('Jean Dupont')).toEqual({ firstName: 'Jean', lastName: 'Dupont' });
    expect(splitFullName('Jean DUPONT')).toEqual({ firstName: 'Jean', lastName: 'DUPONT' });
    expect(splitFullName('Jean-Marc de La Tour')).toEqual({ firstName: 'Jean-Marc', lastName: 'de La Tour' });
  });

  it('traite les mots en capitales placés en tête comme le nom', () => {
    expect(splitFullName('DUPONT Jean')).toEqual({ firstName: 'Jean', lastName: 'DUPONT' });
    expect(splitFullName('LE GALL Yann')).toEqual({ firstName: 'Yann', lastName: 'LE GALL' });
    expect(splitFullName('ÉLOI Zoé Anne')).toEqual({ firstName: 'Zoé Anne', lastName: 'ÉLOI' });
  });

  it('garde le premier mot comme prénom quand tout est en capitales', () => {
    expect(splitFullName('JEAN DUPONT')).toEqual({ firstName: 'JEAN', lastName: 'DUPONT' });
  });

  it('gère un seul mot ou une chaîne vide', () => {
    expect(splitFullName('  Jean ')).toEqual({ firstName: 'Jean', lastName: '' });
    expect(splitFullName('')).toEqual({ firstName: '', lastName: '' });
  });
});
