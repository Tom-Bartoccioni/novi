import { LinkEmployer } from '@/components/link-employer';
import { listUnmatchedOffers } from '@/lib/data';
import { db } from '@/lib/db';
import { formatDate } from '@/lib/format';

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
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucune offre orpheline. Lancer `pnpm pipeline ingest offres` puis `pnpm pipeline match offres` pour
          en voir.
        </p>
      ) : (
        <ul className="space-y-4">
          {groups.map((g) => (
            <li key={g.employerName} className="rounded-lg border p-3">
              <div className="flex items-baseline justify-between">
                <h2 className="font-medium">{g.employerName}</h2>
                <span className="text-sm text-muted-foreground">
                  {g.count} offre{g.count > 1 ? 's' : ''}
                </span>
              </div>
              <ul className="mt-1 text-sm">
                {g.offers.slice(0, 5).map((o) => (
                  <li key={o.id}>
                    {o.url ? (
                      <a
                        href={o.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2"
                      >
                        {o.title}
                      </a>
                    ) : (
                      o.title
                    )}
                    <span className="text-muted-foreground">
                      {' '}
                      · {o.city ?? '—'} · {formatDate(o.publishedAt)}
                    </span>
                  </li>
                ))}
              </ul>
              <LinkEmployer employerName={g.employerName} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
