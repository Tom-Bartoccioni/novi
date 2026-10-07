import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb } from '../src/client';
import { migrateAndSeed } from '../src/migrate';
import {
  deleteCoverLetter,
  getCoverLetter,
  getDefaultProfile,
  insertCoverLetter,
  listCoverLetters,
  recordOfferViews,
  seenOfferIds,
  updateCoverLetterContent,
} from '../src/queries';
import { companies, coverLetters, jobOffers, offerViews, profiles } from '../src/schema';

function setup() {
  const db = createDb(':memory:');
  migrateAndSeed(db);
  db.insert(companies)
    .values({
      siren: '000000001',
      name: 'Cliken Web',
      legalName: 'CLIKEN WEB',
      nafCode: '62.01Z',
      siretLocal: 'a',
      latitude: 43.6,
      longitude: 7.0,
    })
    .run();
  db.insert(jobOffers)
    .values([
      { id: 'A', title: 'Dev React', siren: '000000001' },
      { id: 'B', title: 'Dev Go', siren: '000000001' },
    ])
    .run();
  return db;
}

describe('migration 0002', () => {
  it('adds the V2 profile columns with their defaults', () => {
    const db = setup();
    const p = getDefaultProfile(db);
    expect(p.newOfferDays).toBe(7);
    expect(p.revealFirstName).toBe(false);
    expect(p.links).toEqual([]);
    expect(p.cvText).toBeNull();
    db.update(profiles)
      .set({ firstName: 'Jean', lastName: 'Dupont', cvText: 'texte', cvPages: 2, links: ['https://x.y'] })
      .where(eq(profiles.id, p.id))
      .run();
    expect(getDefaultProfile(db)).toMatchObject({ firstName: 'Jean', cvPages: 2, links: ['https://x.y'] });
  });
});

describe('offer views', () => {
  it('records unseen offers once and reports which were new', () => {
    const db = setup();
    const profileId = getDefaultProfile(db).id;
    expect(recordOfferViews(db, profileId, ['A', 'B'])).toEqual(['A', 'B']);
    expect(recordOfferViews(db, profileId, ['A', 'B'])).toEqual([]);
    expect(seenOfferIds(db, profileId)).toEqual(new Set(['A', 'B']));
    expect(db.select().from(offerViews).all()).toHaveLength(2);
  });
  it('ignores duplicated ids', () => {
    const db = setup();
    const profileId = getDefaultProfile(db).id;
    expect(recordOfferViews(db, profileId, ['A', 'A'])).toEqual(['A']);
  });
  it('cascades when the offer disappears', () => {
    const db = setup();
    const profileId = getDefaultProfile(db).id;
    recordOfferViews(db, profileId, ['A']);
    db.delete(jobOffers).where(eq(jobOffers.id, 'A')).run();
    expect(db.select().from(offerViews).all()).toHaveLength(0);
  });
});

describe('cover letters', () => {
  it('inserts, lists newest first and deletes for the owning profile only', () => {
    const db = setup();
    const profileId = getDefaultProfile(db).id;
    const first = insertCoverLetter(db, {
      profileId,
      siren: '000000001',
      offerId: 'A',
      instruction: null,
      content: 'Lettre 1',
      model: 'openai-compatible/m',
    });
    insertCoverLetter(db, {
      profileId,
      siren: '000000001',
      offerId: null,
      instruction: 'court',
      content: 'Lettre 2',
      model: 'openai-compatible/m',
    });
    const letters = listCoverLetters(db, profileId, '000000001');
    expect(letters.map((l) => l.content)).toEqual(['Lettre 2', 'Lettre 1']);
    expect(letters[0]?.offerTitle).toBeNull();
    expect(letters[1]?.offerTitle).toBe('Dev React');
    expect(deleteCoverLetter(db, 999, first.id)).toBe(false);
    expect(deleteCoverLetter(db, profileId, first.id)).toBe(true);
    expect(db.select().from(coverLetters).all()).toHaveLength(1);
  });
  it('keeps the letter when its offer is deleted', () => {
    const db = setup();
    const profileId = getDefaultProfile(db).id;
    insertCoverLetter(db, {
      profileId,
      siren: '000000001',
      offerId: 'A',
      instruction: null,
      content: 'L',
      model: 'm',
    });
    db.delete(jobOffers).where(eq(jobOffers.id, 'A')).run();
    expect(listCoverLetters(db, profileId, '000000001')[0]).toMatchObject({
      offerId: null,
      offerTitle: null,
    });
  });
});

describe('cover letter export helpers', () => {
  it('reads one letter with its company name, scoped to the profile', () => {
    const db = setup();
    const profileId = getDefaultProfile(db).id;
    const row = insertCoverLetter(db, {
      profileId,
      siren: '000000001',
      offerId: 'A',
      instruction: null,
      content: 'Texte',
      model: 'm',
    });
    expect(getCoverLetter(db, profileId, row.id)).toMatchObject({
      id: row.id,
      siren: '000000001',
      companyName: 'Cliken Web',
      offerTitle: 'Dev React',
      content: 'Texte',
    });
    expect(getCoverLetter(db, 999, row.id)).toBeUndefined();
  });
  it('updates the content for the owning profile only', () => {
    const db = setup();
    const profileId = getDefaultProfile(db).id;
    const row = insertCoverLetter(db, {
      profileId,
      siren: '000000001',
      offerId: null,
      instruction: null,
      content: 'Avant',
      model: 'm',
    });
    expect(updateCoverLetterContent(db, 999, row.id, 'Pirate')).toBe(false);
    expect(updateCoverLetterContent(db, profileId, row.id, 'Après')).toBe(true);
    expect(getCoverLetter(db, profileId, row.id)?.content).toBe('Après');
  });
});
