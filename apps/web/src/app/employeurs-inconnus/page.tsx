import { UnknownEmployersList } from '@/components/unknown-employers';
import { listUnmatchedOffers } from '@/lib/data';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function UnknownEmployersPage() {
  const groups = listUnmatchedOffers(db());
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Employeurs inconnus</h1>
        <p className="text-sm text-muted-foreground">
          Offres actives dont l'employeur n'a pas été rattaché à une entreprise de la base. Rattacher un
          employeur mémorise l'alias pour les prochains runs.
        </p>
      </div>
      <UnknownEmployersList groups={groups} />
    </div>
  );
}
