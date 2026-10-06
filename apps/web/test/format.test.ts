import { describe, expect, it } from 'vitest';
import { splitFullName } from '@/lib/format';

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
