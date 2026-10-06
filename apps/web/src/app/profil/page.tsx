import { analyzeCv, detectIdentityHints } from '@novi/assist';
import { loadTechTags } from '@novi/core';
import { ProfileForm } from '@/components/profile-form';
import { getProfile } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function ProfilePage() {
  const p = getProfile();
  const allTags = loadTechTags();
  const tags = allTags.map((t) => ({ slug: t.slug, label: t.label, category: t.category }));
  const labels = new Map(allTags.map((t) => [t.slug, t.label]));
  const skills = new Set(p.skills);
  const cvTechs = p.cvText
    ? [...new Set(analyzeCv(p.cvText, allTags).techs.map((d) => d.slug))].map((slug) => ({
        slug,
        label: labels.get(slug) ?? slug,
        inProfile: skills.has(slug),
      }))
    : [];
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
