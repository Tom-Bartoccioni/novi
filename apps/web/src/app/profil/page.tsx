import { detectIdentityHints } from '@novi/assist';
import { loadTechTags } from '@novi/core';
import { ProfileForm } from '@/components/profile-form';
import { cvTechsFor } from '@/lib/cv';
import { getProfile } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function ProfilePage() {
  const p = getProfile();
  const tags = loadTechTags().map((t) => ({ slug: t.slug, label: t.label, category: t.category }));
  const cvTechs = p.cvText ? cvTechsFor(p.cvText, p.skills) : [];
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Profil</h1>
      <ProfileForm
        initial={{
          homeLabel: p.homeLabel,
          homeLatitude: p.homeLatitude,
          homeLongitude: p.homeLongitude,
          radiusKm: p.radiusKm,
          skills: p.skills,
          headcountRanges: p.headcountRanges,
          firstName: p.firstName ?? '',
          lastName: p.lastName ?? '',
          email: p.email ?? '',
          phone: p.phone ?? '',
          postalAddress: p.postalAddress ?? '',
          links: p.links,
          revealFirstName: p.revealFirstName,
          newOfferDays: p.newOfferDays,
          cv:
            p.cvText && p.cvFilename
              ? {
                  filename: p.cvFilename,
                  pages: p.cvPages ?? 0,
                  uploadedAt: p.cvUploadedAt ?? '',
                  text: p.cvText,
                }
              : null,
          cvTechs,
          nameCandidates: p.cvText && !p.lastName ? detectIdentityHints(p.cvText).nameCandidates : [],
        }}
        tags={tags}
      />
    </div>
  );
}
