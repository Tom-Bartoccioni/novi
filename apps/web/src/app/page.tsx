import { getProfile } from '@/lib/db';

export default function Home() {
  const profile = getProfile();
  return (
    <p>
      Profil : {profile.homeLabel}, rayon {profile.radiusKm} km.
    </p>
  );
}
