import { loadIngestConfig } from '@novi/core';
import { Suspense } from 'react';
import { Explore } from '@/components/explore';
import { FiltersBar } from '@/components/filters';
import { availableTechs, countCompanies, listCompanies, parseFilters } from '@/lib/data';
import { db, getProfile } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const profile = getProfile();
  const companies = listCompanies(db(), profile, filters);
  const techs = availableTechs(db());
  const noData = countCompanies(db()) === 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">
          Autour de {profile.homeLabel}, {profile.radiusKm} km
        </h1>
        {profile.skills.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Aucune compétence dans le profil : le score ignore les technos.{' '}
            <a className="underline" href="/profil">
              Compléter le profil
            </a>
            .
          </p>
        )}
      </div>
      {noData ? (
        <div className="rounded-lg border p-6 text-sm">
          <p className="font-medium">Aucune donnée.</p>
          <p className="mt-1 text-muted-foreground">Lancer le pipeline depuis la racine du dépôt :</p>
          <pre className="mt-2 rounded bg-muted p-2">pnpm pipeline run all --departement 06</pre>
        </div>
      ) : (
        <>
          <Suspense fallback={null}>
            <FiltersBar filters={filters} techs={techs} headcountCodes={loadIngestConfig().headcountRanges} />
          </Suspense>
          <Explore
            companies={companies}
            home={{
              latitude: profile.homeLatitude,
              longitude: profile.homeLongitude,
              radiusKm: profile.radiusKm,
            }}
          />
        </>
      )}
    </div>
  );
}
