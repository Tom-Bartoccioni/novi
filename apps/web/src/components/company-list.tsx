'use client';

import Link from 'next/link';
import { StatusBadge, TechBadge } from '@/components/tech-badge';
import type { CompanyListItem } from '@/lib/data';
import { formatDistance, headcountLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

export function CompanyList({
  companies,
  highlighted,
  onHover,
}: {
  companies: CompanyListItem[];
  highlighted: string | null;
  onHover: (siren: string | null) => void;
}) {
  if (companies.length === 0)
    return <p className="text-sm text-muted-foreground">Aucune entreprise ne correspond à ces filtres.</p>;
  return (
    <ul className="divide-y">
      {companies.map((c) => (
        <li
          key={c.siren}
          id={`company-${c.siren}`}
          onMouseEnter={() => onHover(c.siren)}
          onMouseLeave={() => onHover(null)}
          className={cn('py-3 transition-colors', highlighted === c.siren && 'bg-muted/60')}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/entreprises/${c.siren}`} className="font-medium hover:underline">
                {c.name}
              </Link>
              <p className="text-xs text-muted-foreground">
                {c.city ?? '—'} · {formatDistance(c.distanceKm)} · {headcountLabel(c.headcountRange)}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {c.topTechs.map((t) => (
                  <TechBadge key={t.slug} label={t.label} confidence={t.confidence} />
                ))}
                {c.recruiting && <TechBadge label="Recrute" highlighted />}
                <StatusBadge status={c.status} />
              </div>
            </div>
            <div
              className="shrink-0 rounded-md bg-muted px-2 py-1 text-sm font-semibold tabular-nums"
              title="Score"
            >
              {c.score}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
