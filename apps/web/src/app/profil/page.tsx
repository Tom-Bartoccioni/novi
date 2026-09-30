import { loadTechTags } from '@novi/core';
import { ProfileForm } from '@/components/profile-form';
import { getProfile } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function ProfilePage() {
  const p = getProfile();
  const tags = loadTechTags().map((t) => ({ slug: t.slug, label: t.label, category: t.category }));
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
        }}
        tags={tags}
      />
    </div>
  );
}
