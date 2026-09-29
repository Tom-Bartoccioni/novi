'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { CompanyList } from '@/components/company-list';
import { CompanyMap } from '@/components/company-map';
import type { CompanyListItem } from '@/lib/data';

export function Explore({
  companies,
  home,
}: {
  companies: CompanyListItem[];
  home: { latitude: number; longitude: number; radiusKm: number };
}) {
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const router = useRouter();
  const onHover = useCallback((siren: string | null) => setHighlighted(siren), []);
  const onSelect = useCallback((siren: string) => router.push(`/entreprises/${siren}`), [router]);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="order-2 max-h-[calc(100vh-8rem)] overflow-y-auto pr-1 lg:order-1">
        <p className="mb-2 text-sm text-muted-foreground">{companies.length} entreprises</p>
        <CompanyList companies={companies} highlighted={highlighted} onHover={onHover} />
      </div>
      <div className="order-1 lg:order-2">
        <CompanyMap
          home={home}
          companies={companies}
          highlighted={highlighted}
          onHover={onHover}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}
