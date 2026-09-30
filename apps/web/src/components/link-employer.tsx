'use client';

import { useEffect, useState, useTransition } from 'react';
import { linkEmployer } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Hit = { siren: string; name: string; city: string | null };

/**
 * Le succès est remonté via `onDone` : le groupe disparaît au rafraîchissement serveur,
 * le message doit donc vivre au-dessus de la liste. Les erreurs restent affichées ici.
 */
export function LinkEmployer({
  employerName,
  onDone,
}: {
  employerName: string;
  onDone: (message: string) => void;
}) {
  const [q, setQ] = useState(employerName);
  const [hits, setHits] = useState<Hit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!q.trim()) {
        setHits([]);
        setSearchError(null);
        return;
      }
      try {
        const res = await fetch(`/api/recherche-entreprises?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setHits((await res.json()) as Hit[]);
        setSearchError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setHits([]);
        setSearchError('Recherche indisponible');
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  return (
    <div className="mt-2 space-y-2 rounded-md border p-2 text-sm">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Chercher une entreprise de la base"
        className="h-8"
      />
      {searchError && <p className="text-destructive">{searchError}</p>}
      {hits.length > 0 && (
        <ul className="max-h-40 overflow-y-auto">
          {hits.map((h) => (
            <li key={h.siren} className="flex items-center justify-between py-1">
              <span>
                {h.name} <span className="text-muted-foreground">{h.city ?? ''}</span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await linkEmployer(employerName, h.siren);
                    if (r.ok) {
                      setError(null);
                      onDone(r.message ?? 'Rattaché');
                    } else setError(r.error);
                  })
                }
              >
                Rattacher
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}
