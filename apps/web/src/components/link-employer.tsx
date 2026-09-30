'use client';

import { useEffect, useState, useTransition } from 'react';
import { linkEmployer } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Hit = { siren: string; name: string; city: string | null };

export function LinkEmployer({ employerName }: { employerName: string }) {
  const [q, setQ] = useState(employerName);
  const [hits, setHits] = useState<Hit[]>([]);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!q.trim()) return setHits([]);
      try {
        const res = await fetch(`/api/recherche-entreprises?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        setHits((await res.json()) as Hit[]);
      } catch {
        /* requête annulée */
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
                    setMessage(r.ok ? (r.message ?? 'Rattaché') : r.error);
                  })
                }
              >
                Rattacher
              </Button>
            </li>
          ))}
        </ul>
      )}
      {message && <p className="text-muted-foreground">{message}</p>}
    </div>
  );
}
