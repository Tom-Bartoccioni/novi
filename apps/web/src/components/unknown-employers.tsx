'use client';

import { useState } from 'react';
import { LinkEmployer } from '@/components/link-employer';
import type { UnmatchedGroup } from '@/lib/data';
import { formatDate } from '@/lib/format';

/** Porte le message de succès au-dessus de la liste : le groupe rattaché disparaît au rafraîchissement. */
export function UnknownEmployersList({ groups }: { groups: UnmatchedGroup[] }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {message && <p className="rounded-md border p-2 text-sm text-muted-foreground">{message}</p>}
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
              <LinkEmployer employerName={g.employerName} onDone={setMessage} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
