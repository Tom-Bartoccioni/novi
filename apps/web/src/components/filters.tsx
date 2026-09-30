'use client';

import { HEADCOUNT_LABELS } from '@novi/core';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import type { Filters } from '@/lib/data';

const STATUS_OPTIONS = [
  ['', 'Tous statuts'],
  ['to_review', 'À voir'],
  ['interested', 'Intéressée'],
  ['contacted', 'Contactée'],
  ['rejected', 'Refusée'],
  ['ignored', 'Ignorée'],
] as const;

function splitList(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function FiltersBar({
  filters,
  techs,
  headcountCodes,
}: {
  filters: Filters;
  techs: { slug: string; label: string; count: number }[];
  headcountCodes: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  /** Derniers paramètres envoyés au routeur, tant que la navigation n'a pas livré les nouveaux `params`. */
  const pendingRef = useRef<URLSearchParams | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentQ = useRef(filters.q);
  const [q, setQ] = useState(filters.q);

  useEffect(() => {
    if (params) pendingRef.current = null;
  }, [params]);
  // Retour arrière ou lien : la recherche vient de l'URL, pas de la saisie en cours.
  useEffect(() => {
    if (filters.q !== lastSentQ.current) {
      lastSentQ.current = filters.q;
      setQ(filters.q);
    }
  }, [filters.q]);
  useEffect(() => () => clearTimeout(searchTimer.current ?? undefined), []);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(pendingRef.current ?? params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    pendingRef.current = next;
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };
  const toggleIn = (key: 'techs' | 'headcount', value: string) => {
    const current = splitList((pendingRef.current ?? params).get(key));
    const nextList = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    update({ [key]: nextList.join(',') });
  };
  const updateSearch = (value: string) => {
    setQ(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      lastSentQ.current = value;
      update({ q: value });
    }, 300);
  };

  const selectedFirst = [...techs].sort(
    (a, b) => Number(filters.techs.includes(b.slug)) - Number(filters.techs.includes(a.slug)),
  );

  return (
    <div className="space-y-3 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Nom ou ville"
          value={q}
          onChange={(e) => updateSearch(e.target.value)}
          className="h-8 w-48"
        />
        <select
          className="h-8 rounded-md border bg-background px-2"
          value={filters.sort}
          onChange={(e) => update({ sort: e.target.value })}
        >
          <option value="score">Tri : score</option>
          <option value="distance">Tri : distance</option>
          <option value="size">Tri : taille</option>
        </select>
        <select
          className="h-8 rounded-md border bg-background px-2"
          value={filters.status ?? ''}
          onChange={(e) => update({ status: e.target.value })}
        >
          {STATUS_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={filters.recruiting}
            onChange={(e) => update({ recruiting: e.target.checked ? '1' : null })}
          />
          Recrute actuellement
        </label>
      </div>
      <div className="flex flex-wrap gap-1">
        {headcountCodes.map((code) => (
          <button
            type="button"
            key={code}
            onClick={() => toggleIn('headcount', code)}
            className={`rounded-full border px-2 py-0.5 ${filters.headcount.includes(code) ? 'bg-foreground text-background' : ''}`}
          >
            {HEADCOUNT_LABELS[code] ?? code}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-muted-foreground">Toutes ces technos :</span>
        {selectedFirst.slice(0, 40).map((t) => (
          <button
            type="button"
            key={t.slug}
            onClick={() => toggleIn('techs', t.slug)}
            className={`rounded-full border px-2 py-0.5 ${filters.techs.includes(t.slug) ? 'bg-foreground text-background' : ''}`}
          >
            {t.label} <span className="text-muted-foreground">{t.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
