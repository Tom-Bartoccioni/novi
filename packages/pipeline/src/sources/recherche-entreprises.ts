import type { NewCompany } from '@novi/db';
import { z } from 'zod';
import { fetchJson } from '../lib/http';
import { createLimiter } from '../lib/rate-limit';

const BASE_URL = 'https://recherche-entreprises.api.gouv.fr/search';
export const PER_PAGE = 25;

const numberish = z
  .union([z.number(), z.string()])
  .transform((v) => (v === '' ? null : Number(v)))
  .nullable();

const establishmentSchema = z
  .object({
    siret: z.string(),
    departement: z.string().nullable().optional(),
    code_postal: z.string().nullable(),
    libelle_commune: z.string().nullable(),
    adresse: z.string().nullable(),
    latitude: numberish,
    longitude: numberish,
    est_siege: z.boolean(),
    etat_administratif: z.string().nullable(),
    activite_principale: z.string().nullable(),
    liste_enseignes: z.array(z.string()).nullable(),
    nom_commercial: z.string().nullable(),
  })
  .passthrough();

export const resultSchema = z
  .object({
    siren: z.string(),
    nom_complet: z.string(),
    nom_raison_sociale: z.string().nullable(),
    sigle: z.string().nullable(),
    siege: establishmentSchema,
    activite_principale: z.string(),
    categorie_entreprise: z.string().nullable(),
    date_creation: z.string().nullable(),
    tranche_effectif_salarie: z.string().nullable(),
    annee_tranche_effectif_salarie: z.string().nullable(),
    etat_administratif: z.string(),
    matching_etablissements: z.array(establishmentSchema).default([]),
    finances: z
      .record(z.string(), z.object({ ca: z.number().nullable(), resultat_net: z.number().nullable() }))
      .nullable()
      .optional(),
  })
  .passthrough();

export type SearchResult = z.infer<typeof resultSchema>;

export const searchPageSchema = z.object({
  results: z.array(resultSchema),
  total_results: z.number(),
  page: z.number(),
  per_page: z.number(),
  total_pages: z.number(),
});

export type SearchPage = z.infer<typeof searchPageSchema>;

const limiter = createLimiter(6);

export async function fetchSearchPage(params: {
  departement: string;
  nafCode: string;
  headcountRange: string;
  page: number;
}): Promise<SearchPage> {
  const url = new URL(BASE_URL);
  url.searchParams.set('departement', params.departement);
  url.searchParams.set('activite_principale', params.nafCode);
  url.searchParams.set('tranche_effectif_salarie', params.headcountRange);
  url.searchParams.set('etat_administratif', 'A');
  url.searchParams.set('est_entrepreneur_individuel', 'false');
  url.searchParams.set('per_page', String(PER_PAGE));
  url.searchParams.set('page', String(params.page));
  const { data } = await limiter(() => fetchJson<unknown>(url.toString(), { timeoutMs: 20_000 }));
  return searchPageSchema.parse(data);
}

/** Itère toutes les pages d'une combinaison NAF × tranche. */
export async function* iterateSearch(params: {
  departement: string;
  nafCode: string;
  headcountRange: string;
}) {
  let page = 1;
  for (;;) {
    const result = await fetchSearchPage({ ...params, page });
    for (const r of result.results) yield r;
    if (page >= result.total_pages || result.results.length === 0) return;
    page += 1;
  }
}

export type LocalEstablishment = {
  siret: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  headquartersInZone: boolean;
  tradeNames: string[];
};

function establishmentDepartement(e: z.infer<typeof establishmentSchema>): string | null {
  if (e.departement) return e.departement;
  return e.code_postal ? e.code_postal.slice(0, 2) : null;
}

function toLocal(
  e: z.infer<typeof establishmentSchema>,
  headquartersInZone: boolean,
): LocalEstablishment | null {
  if (e.latitude === null || e.longitude === null || Number.isNaN(e.latitude) || Number.isNaN(e.longitude))
    return null;
  const tradeNames = [e.nom_commercial, ...(e.liste_enseignes ?? [])].filter((n): n is string => !!n);
  return {
    siret: e.siret,
    address: e.adresse,
    postalCode: e.code_postal,
    city: e.libelle_commune,
    latitude: e.latitude,
    longitude: e.longitude,
    headquartersInZone,
    tradeNames,
  };
}

/** Le siège s'il est dans le département, sinon le premier établissement actif qui y est. */
export function pickLocalEstablishment(result: SearchResult, departement: string): LocalEstablishment | null {
  if (establishmentDepartement(result.siege) === departement) return toLocal(result.siege, true);
  const candidate = result.matching_etablissements.find(
    (e) => establishmentDepartement(e) === departement && e.etat_administratif === 'A' && e.latitude !== null,
  );
  return candidate ? toLocal(candidate, false) : null;
}

export function toCompanyRow(
  result: SearchResult,
  departement: string,
  nafLabels: Record<string, string>,
): NewCompany | null {
  const local = pickLocalEstablishment(result, departement);
  if (!local) return null;
  const legalName = result.nom_raison_sociale ?? result.nom_complet;
  const tradeNames = [
    ...new Set([result.siege.nom_commercial, ...local.tradeNames].filter((n): n is string => !!n)),
  ];
  return {
    siren: result.siren,
    name: tradeNames[0] ?? legalName,
    legalName,
    tradeNames,
    nafCode: result.activite_principale,
    nafLabel: nafLabels[result.activite_principale] ?? null,
    headcountRange: result.tranche_effectif_salarie,
    headcountYear: result.annee_tranche_effectif_salarie,
    companyCategory: result.categorie_entreprise,
    foundedAt: result.date_creation,
    siretLocal: local.siret,
    address: local.address,
    postalCode: local.postalCode,
    city: local.city,
    latitude: local.latitude,
    longitude: local.longitude,
    headquartersInZone: local.headquartersInZone,
    finances: result.finances ?? null,
    rawSirene: result,
  };
}
