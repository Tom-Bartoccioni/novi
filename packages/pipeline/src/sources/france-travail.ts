import type { NewJobOffer } from '@novi/db';
import { z } from 'zod';
import { optionalEnv, requireEnv } from '../lib/env';
import { fetchWithTimeout, HttpError } from '../lib/http';
import { warn } from '../lib/logger';
import { createLimiter } from '../lib/rate-limit';

const TOKEN_URL = 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire';
const SEARCH_URL = 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';
export const PAGE_SIZE = 150;
export const MAX_INDEX = 3149;
const SCOPES = 'api_offresdemploiv2 o2dsoffre';

export const offerSchema = z
  .object({
    id: z.string(),
    intitule: z.string(),
    description: z.string().optional(),
    dateCreation: z.string(),
    dateActualisation: z.string().optional(),
    romeCode: z.string().optional(),
    typeContrat: z.string().optional(),
    typeContratLibelle: z.string().optional(),
    lieuTravail: z
      .object({
        libelle: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        codePostal: z.string().optional(),
        commune: z.string().optional(),
      })
      .passthrough()
      .optional(),
    entreprise: z
      .object({ nom: z.string().optional(), description: z.string().optional(), url: z.string().optional() })
      .passthrough()
      .optional(),
    origineOffre: z
      .object({
        origine: z.string().optional(),
        urlOrigine: z.string().optional(),
        partenaires: z
          .array(z.object({ nom: z.string().optional(), url: z.string().optional() }).passthrough())
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type Offer = z.infer<typeof offerSchema>;

export const searchResponseSchema = z.object({ resultats: z.array(offerSchema).default([]) }).passthrough();

export type ContentRange = { first: number; last: number; total: number };

export function parseContentRange(header: string | null): ContentRange | null {
  if (!header) return null;
  const m = /(\d+)-(\d+)\/(\d+)/.exec(header);
  if (!m) return null;
  return { first: Number(m[1]), last: Number(m[2]), total: Number(m[3]) };
}

export type DateWindow = { min: string; max: string };

function isoNoMillis(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Fenêtres mensuelles consécutives, de la plus récente à la plus ancienne. */
export function monthlyWindows(now: Date, months: number): DateWindow[] {
  // Chaque borne est calculée depuis `now` (et non depuis la borne précédente) pour éviter
  // la dérive quand un mois n'a pas le jour voulu (ex. 29 février → 1er mars).
  const boundary = (monthsAgo: number): string => {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - monthsAgo);
    return isoNoMillis(d);
  };
  const windows: DateWindow[] = [];
  for (let i = 0; i < months; i++) {
    windows.push({ min: boundary(i + 1), max: boundary(i) });
  }
  return windows;
}

function cityFromLabel(label: string | undefined): string | null {
  if (!label) return null;
  const m = /^\d{2,3}\s*-\s*(.+)$/.exec(label);
  return (m ? m[1] : label)?.trim() ?? null;
}

export function toOfferRow(offer: Offer, runId: number): NewJobOffer {
  return {
    id: offer.id,
    source: 'france_travail',
    employerName: offer.entreprise?.nom ?? null,
    title: offer.intitule,
    description: offer.description ?? null,
    url: offer.origineOffre?.urlOrigine ?? offer.origineOffre?.partenaires?.[0]?.url ?? null,
    contractType: offer.typeContrat ?? null,
    publishedAt: offer.dateCreation,
    updatedAtSource: offer.dateActualisation ?? null,
    latitude: offer.lieuTravail?.latitude ?? null,
    longitude: offer.lieuTravail?.longitude ?? null,
    city: cityFromLabel(offer.lieuTravail?.libelle),
    isActive: true,
    lastSeenRunId: runId,
    raw: offer,
  };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: requireEnv('FRANCE_TRAVAIL_CLIENT_ID'),
    client_secret: requireEnv('FRANCE_TRAVAIL_CLIENT_SECRET'),
    scope: SCOPES,
  });
  const response = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      TOKEN_URL,
      `Authentification France Travail refusée (${response.status}). Vérifier FRANCE_TRAVAIL_CLIENT_ID / SECRET et l'activation de l'API Offres d'emploi v2.`,
    );
  }
  const json = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

const limiter = createLimiter(8);

export type SearchParams = { departement: string; romeCode: string; window: DateWindow; first: number };

export async function searchOffers(
  params: SearchParams,
): Promise<{ offers: Offer[]; range: ContentRange | null }> {
  const token = await getAccessToken();
  const url = new URL(SEARCH_URL);
  url.searchParams.set('departement', params.departement);
  url.searchParams.set('codeROME', params.romeCode);
  url.searchParams.set('minCreationDate', params.window.min);
  url.searchParams.set('maxCreationDate', params.window.max);
  const last = Math.min(params.first + PAGE_SIZE - 1, MAX_INDEX);
  url.searchParams.set('range', `${params.first}-${last}`);
  const response = await limiter(() =>
    fetchWithTimeout(url.toString(), {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      timeoutMs: 30_000,
    }),
  );
  if (response.status === 204) return { offers: [], range: null };
  if (response.status !== 200 && response.status !== 206)
    throw new HttpError(response.status, url.toString());
  const data = searchResponseSchema.parse(await response.json());
  return { offers: data.resultats, range: parseContentRange(response.headers.get('content-range')) };
}

/** Itère toutes les offres d'un département pour des codes ROME, sur 12 fenêtres mensuelles. */
export async function* iterateOffers(
  departement: string,
  romeCodes: string[],
  now = new Date(),
): AsyncGenerator<Offer> {
  for (const romeCode of romeCodes) {
    for (const window of monthlyWindows(now, 12)) {
      let first = 0;
      for (;;) {
        const { offers, range } = await searchOffers({ departement, romeCode, window, first });
        for (const o of offers) yield o;
        if (offers.length < PAGE_SIZE || !range) break;
        if (range.total > MAX_INDEX + 1 && first === 0) {
          warn(
            `France Travail ${romeCode} ${window.min}→${window.max} : ${range.total} offres, seules les ${MAX_INDEX + 1} premières seront lues`,
          );
        }
        first = range.last + 1;
        if (first > MAX_INDEX || first >= range.total) break;
      }
    }
  }
}

export function hasCredentials(): boolean {
  return !!optionalEnv('FRANCE_TRAVAIL_CLIENT_ID') && !!optionalEnv('FRANCE_TRAVAIL_CLIENT_SECRET');
}
