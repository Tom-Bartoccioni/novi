import type { TextGenerator } from '@novi/assist';
import { coverLetters, getDefaultProfile, profiles } from '@novi/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { generateLetterFor } from '@/lib/letters';
import { seededDb } from './helpers';

function ready() {
  const db = seededDb();
  const id = getDefaultProfile(db).id;
  db.update(profiles)
    .set({
      firstName: 'Jean',
      lastName: 'Dupont',
      phone: '06 12 34 56 78',
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
    const sent = gen.generate.mock.calls[0]?.[0] as { system: string; prompt: string };
    expect(sent.prompt).not.toContain('Dupont');
    expect(sent.prompt).not.toContain('06 12 34 56 78');
    expect(sent.prompt).toContain('[NOM]');
    expect(sent.prompt).toContain('Cliken Web');
    expect(sent.prompt).toContain('Dev React');
    expect(sent.prompt).toContain('Court');
    expect(out.letter.content).toBe('Madame, Monsieur,\n\nDéveloppeur React…\n\nJean Dupont\n06 12 34 56 78');
    expect(out.letter.model).toBe('fake/m');
    expect(out.letter.offerTitle).toBe('Dev React');
    expect(out.sentPrompt).toBe(sent.prompt);
    expect(db.select().from(coverLetters).all()).toHaveLength(1);
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
  });
});
