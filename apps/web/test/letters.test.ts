import type { TextGenerator } from '@novi/assist';
import { companies, coverLetters, getDefaultProfile, jobOffers, profiles } from '@novi/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { generateLetterFor, townOf } from '@/lib/letters';
import { seededDb } from './helpers';

function ready() {
  const db = seededDb();
  const id = getDefaultProfile(db).id;
  db.update(profiles)
    .set({
      firstName: 'Jean',
      lastName: 'Dupont',
      phone: '06 12 34 56 78',
      homeLabel: '186 Avenue de Fabron 06200 Nice',
      cvText: 'Jean Dupont\n06 12 34 56 78\nDéveloppeur React depuis 2020',
      skills: ['react'],
    })
    .where(eq(profiles.id, id))
    .run();
  return { db, profile: getDefaultProfile(db) };
}

function fakeGenerator(reply: string): TextGenerator & { generate: ReturnType<typeof vi.fn> } {
  return { label: 'fake/m', generate: vi.fn(async () => ({ text: reply, model: 'm-1' })) };
}

function sentOf(gen: { generate: ReturnType<typeof vi.fn> }) {
  return gen.generate.mock.calls[0]?.[0] as { system: string; prompt: string };
}

describe('townOf', () => {
  it('keeps only the town after the postcode', () => {
    expect(townOf('186 Avenue de Fabron 06200 Nice')).toBe('Nice');
    expect(townOf('2 rue X 06600 Antibes Juan-les-Pins')).toBe('Antibes Juan-les-Pins');
  });
  it('falls back to the full label without a postcode', () => {
    expect(townOf('Antibes')).toBe('Antibes');
  });
});

describe('generateLetterFor', () => {
  it('anonymises what is sent, restores the letter and stores it', async () => {
    const { db, profile } = ready();
    const gen = fakeGenerator('Madame, Monsieur,\n\nDéveloppeur React…\n\n[PRENOM] [NOM]\n[TELEPHONE]');
    const out = await generateLetterFor(
      db,
      profile,
      { siren: '000000001', offerId: 'A', instruction: 'Court' },
      gen,
    );
    const sent = sentOf(gen);
    expect(sent.prompt).not.toContain('Dupont');
    expect(sent.prompt).not.toContain('06 12 34 56 78');
    expect(sent.prompt).toContain('[NOM]');
    expect(sent.prompt).toContain('Cliken Web');
    expect(sent.prompt).toContain('Dev React');
    expect(sent.prompt).toContain('Court');
    expect(sent.prompt).toContain('Habite : Nice');
    expect(sent.prompt).not.toContain('Fabron');
    expect(out.letter.content).toBe('Madame, Monsieur,\n\nDéveloppeur React…\n\nJean Dupont\n06 12 34 56 78');
    expect(out.letter.model).toBe('fake/m');
    expect(out.letter.offerTitle).toBe('Dev React');
    expect(out.sentPrompt).toBe(sent.prompt);
    expect(db.select().from(coverLetters).all()).toHaveLength(1);
  });
  it('generates a spontaneous letter without an offer', async () => {
    const { db, profile } = ready();
    const gen = fakeGenerator('Bonjour,\n\n[PRENOM] [NOM]');
    const out = await generateLetterFor(db, profile, { siren: '000000001' }, gen);
    const sent = sentOf(gen);
    expect(sent.prompt).toContain('candidature spontanée');
    expect(sent.prompt).not.toContain('# Offre');
    expect(out.letter.content).toBe('Bonjour,\n\nJean Dupont');
    expect(out.letter.offerId).toBeNull();
    expect(out.letter.offerTitle).toBeNull();
    expect(out.letter.instruction).toBeNull();
    const rows = db.select().from(coverLetters).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.offerId).toBeNull();
  });
  it('masks the offer description and the instruction', async () => {
    const { db, profile } = ready();
    db.update(jobOffers)
      .set({ description: 'React et TypeScript. Contact candidat : 06 12 34 56 78' })
      .where(eq(jobOffers.id, 'A'))
      .run();
    const gen = fakeGenerator('x');
    const out = await generateLetterFor(
      db,
      profile,
      { siren: '000000001', offerId: 'A', instruction: 'Rappeler que M. Dupont a déjà postulé' },
      gen,
    );
    const sent = sentOf(gen);
    expect(sent.prompt).toContain('React et TypeScript');
    expect(sent.prompt).not.toContain('06 12 34 56 78');
    expect(sent.prompt).toContain('[TELEPHONE]');
    expect(sent.prompt).toContain('Rappeler que M. [NOM] a déjà postulé');
    expect(sent.prompt).not.toContain('Dupont');
    expect(out.letter.instruction).toBe('Rappeler que M. Dupont a déjà postulé');
  });
  it('keeps the best-confidence source per tech', async () => {
    const { db, profile } = ready();
    const gen = fakeGenerator('x');
    await generateLetterFor(db, profile, { siren: '000000001' }, gen);
    const sent = sentOf(gen);
    expect(sent.prompt).toContain('React (offre)');
    expect(sent.prompt).not.toContain('React (site)');
    expect(sent.prompt).toMatch(/Technologies repérées : React \(offre\), PostgreSQL \(site\)/);
  });
  it('omits an unknown headcount', async () => {
    const { db, profile } = ready();
    const known = fakeGenerator('x');
    await generateLetterFor(db, profile, { siren: '000000001' }, known);
    expect(sentOf(known).prompt).toContain('Effectif :');
    for (const code of ['NN', '00']) {
      db.update(companies).set({ headcountRange: code }).where(eq(companies.siren, '000000001')).run();
      const gen = fakeGenerator('x');
      await generateLetterFor(db, profile, { siren: '000000001' }, gen);
      expect(sentOf(gen).prompt).not.toContain('Effectif');
    }
  });
  it('writes nothing when the generator fails', async () => {
    const { db, profile } = ready();
    const gen: TextGenerator = {
      label: 'fake/m',
      generate: async () => {
        throw new Error('quota');
      },
    };
    await expect(generateLetterFor(db, profile, { siren: '000000001' }, gen)).rejects.toThrow('quota');
    expect(db.select().from(coverLetters).all()).toHaveLength(0);
  });
  it('refuses without a CV, with an unknown company or a foreign offer', async () => {
    const { db, profile } = ready();
    const gen = fakeGenerator('x');
    db.update(profiles).set({ cvText: null }).where(eq(profiles.id, profile.id)).run();
    await expect(generateLetterFor(db, getDefaultProfile(db), { siren: '000000001' }, gen)).rejects.toThrow(
      /CV/,
    );
    await expect(generateLetterFor(db, profile, { siren: '999' }, gen)).rejects.toThrow(/inconnue/);
    await expect(generateLetterFor(db, profile, { siren: '000000001', offerId: 'B' }, gen)).rejects.toThrow(
      /offre/i,
    );
    expect(gen.generate).not.toHaveBeenCalled();
  });
  it('refuses without a last name, since the CV cannot be anonymised', async () => {
    const { db, profile } = ready();
    const gen = fakeGenerator('x');
    for (const lastName of [null, '   ']) {
      db.update(profiles).set({ lastName }).where(eq(profiles.id, profile.id)).run();
      await expect(generateLetterFor(db, getDefaultProfile(db), { siren: '000000001' }, gen)).rejects.toThrow(
        'Renseignez votre nom dans le profil',
      );
    }
    expect(gen.generate).not.toHaveBeenCalled();
    expect(db.select().from(coverLetters).all()).toHaveLength(0);
  });
});
