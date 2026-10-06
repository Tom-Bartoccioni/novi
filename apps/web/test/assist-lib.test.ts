import { getDefaultProfile, profiles } from '@novi/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { identityFromProfile } from '@/lib/assist';
import { seededDb } from './helpers';

describe('identityFromProfile', () => {
  it('maps the profile columns to an Identity', () => {
    const db = seededDb();
    const p = getDefaultProfile(db);
    db.update(profiles)
      .set({
        firstName: ' Jean ',
        lastName: 'Dupont',
        email: 'j@d.fr',
        links: ['https://a.b'],
        revealFirstName: true,
      })
      .where(eq(profiles.id, p.id))
      .run();
    expect(identityFromProfile(getDefaultProfile(db))).toEqual({
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'j@d.fr',
      phone: null,
      postalAddress: null,
      links: ['https://a.b'],
      revealFirstName: true,
    });
  });
});
