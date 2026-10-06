import { getDefaultProfile, profiles } from '@novi/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { applyCv, applyProfile } from '@/lib/mutations';
import { seededDb } from './helpers';

const baseInput = {
  homeLabel: 'Nice',
  homeLatitude: 43.7,
  homeLongitude: 7.26,
  radiusKm: 30,
  skills: ['react'],
  headcountRanges: ['12'],
};

describe('applyProfile V2', () => {
  it('stores identity fields trimmed, empty as null, and the new-offer window', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    applyProfile(db, id, {
      ...baseInput,
      firstName: ' Jean ',
      lastName: 'Dupont',
      email: '',
      phone: '06 12 34 56 78',
      postalAddress: '',
      links: [' https://github.com/jd ', '', 'linkedin.com/in/jd'],
      revealFirstName: true,
      newOfferDays: 14,
    });
    expect(getDefaultProfile(db)).toMatchObject({
      firstName: 'Jean',
      lastName: 'Dupont',
      email: null,
      phone: '06 12 34 56 78',
      postalAddress: null,
      links: ['https://github.com/jd', 'https://linkedin.com/in/jd'],
      revealFirstName: true,
      newOfferDays: 14,
    });
  });
  it('leaves V2 fields untouched when omitted', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    db.update(profiles).set({ lastName: 'Dupont', newOfferDays: 3 }).where(eq(profiles.id, id)).run();
    applyProfile(db, id, baseInput);
    expect(getDefaultProfile(db)).toMatchObject({ lastName: 'Dupont', newOfferDays: 3 });
  });
  it('validates the window, the email and the links', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    expect(() => applyProfile(db, id, { ...baseInput, newOfferDays: 0 })).toThrow(/entre 1 et 90/);
    expect(() => applyProfile(db, id, { ...baseInput, newOfferDays: 2.5 })).toThrow(/entre 1 et 90/);
    expect(() => applyProfile(db, id, { ...baseInput, email: 'pas-un-mail' })).toThrow(/e-mail/i);
    expect(() => applyProfile(db, id, { ...baseInput, links: ['pas une url'] })).toThrow(/lien/i);
  });
});

describe('applyProfile V2 edge cases', () => {
  it('turns revealFirstName off after it was on', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    applyProfile(db, id, { ...baseInput, revealFirstName: true });
    applyProfile(db, id, { ...baseInput, revealFirstName: false });
    expect(getDefaultProfile(db).revealFirstName).toBe(false);
  });
  it('clears links with an empty list and dedupes them', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    applyProfile(db, id, { ...baseInput, links: ['github.com/a', 'https://github.com/a/'] });
    expect(getDefaultProfile(db).links).toEqual(['https://github.com/a']);
    applyProfile(db, id, { ...baseInput, links: [] });
    expect(getDefaultProfile(db).links).toEqual([]);
  });
  it('trims the email', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    applyProfile(db, id, { ...baseInput, email: ' a@b.fr ' });
    expect(getDefaultProfile(db).email).toBe('a@b.fr');
  });
  it('names the bad link in the error', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    expect(() => applyProfile(db, id, { ...baseInput, links: ['pas une url'] })).toThrow(/pas une url/);
  });
  it('accepts 90 days and rejects 91', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    applyProfile(db, id, { ...baseInput, newOfferDays: 90 });
    expect(getDefaultProfile(db).newOfferDays).toBe(90);
    expect(() => applyProfile(db, id, { ...baseInput, newOfferDays: 91 })).toThrow(/entre 1 et 90/);
  });
  it('rejects a last name too short to be masked, but accepts an empty one', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    for (const lastName of ['Li', ' Ng ', 'X']) {
      expect(() => applyProfile(db, id, { ...baseInput, lastName })).toThrow(
        'Le nom doit faire au moins 3 caractères pour pouvoir être masqué',
      );
    }
    expect(getDefaultProfile(db).lastName).toBeNull();
    applyProfile(db, id, { ...baseInput, lastName: 'Lee' });
    expect(getDefaultProfile(db).lastName).toBe('Lee');
    applyProfile(db, id, { ...baseInput, lastName: '  ' });
    expect(getDefaultProfile(db).lastName).toBeNull();
  });
});

describe('applyCv', () => {
  it('keeps an existing phone and non-empty links', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    db.update(profiles)
      .set({ phone: '07 00', links: ['https://a.fr'] })
      .where(eq(profiles.id, id))
      .run();
    applyCv(
      db,
      id,
      { filename: 'c.pdf', text: 'T', pages: 1 },
      { email: undefined, phone: '06 11', links: ['https://b.fr'], nameCandidates: [] },
    );
    expect(getDefaultProfile(db)).toMatchObject({ phone: '07 00', links: ['https://a.fr'] });
  });
  it('throws on an unknown profile', () => {
    const db = seededDb();
    const hints = { email: undefined, phone: undefined, links: [], nameCandidates: [] };
    expect(() => applyCv(db, 99999, { filename: 'a.pdf', text: 'A', pages: 1 }, hints)).toThrow(
      /introuvable/,
    );
  });
  it('stores the CV and fills only the blank identity fields', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    db.update(profiles).set({ email: 'deja@la.fr' }).where(eq(profiles.id, id)).run();
    applyCv(
      db,
      id,
      { filename: 'cv.pdf', text: 'Texte du CV', pages: 2 },
      { email: 'cv@mail.fr', phone: '06 00 00 00 00', links: ['https://github.com/x'], nameCandidates: [] },
    );
    const p = getDefaultProfile(db);
    expect(p).toMatchObject({
      cvFilename: 'cv.pdf',
      cvText: 'Texte du CV',
      cvPages: 2,
      email: 'deja@la.fr',
      phone: '06 00 00 00 00',
      links: ['https://github.com/x'],
    });
    expect(p.cvUploadedAt).toMatch(/^\d{4}-/);
  });
  it('replaces a previous CV', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    const hints = { email: undefined, phone: undefined, links: [], nameCandidates: [] };
    applyCv(db, id, { filename: 'a.pdf', text: 'A', pages: 1 }, hints);
    applyCv(db, id, { filename: 'b.pdf', text: 'B', pages: 3 }, hints);
    expect(getDefaultProfile(db)).toMatchObject({ cvFilename: 'b.pdf', cvText: 'B', cvPages: 3 });
  });
});
