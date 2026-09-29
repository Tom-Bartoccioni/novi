import { distanceKm, normalizeCompanyName, trigramSimilarity } from '@novi/core';
import { z } from 'zod';
import { fetchJson, HttpError } from '../lib/http';
import { sleep } from '../lib/rate-limit';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const elementSchema = z
  .object({
    type: z.string(),
    id: z.number(),
    lat: z.number().optional(),
    lon: z.number().optional(),
    center: z.object({ lat: z.number(), lon: z.number() }).optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const responseSchema = z.object({ elements: z.array(elementSchema) }).passthrough();

export type OsmBusiness = { name: string; website: string; latitude: number; longitude: number };

export function normalizeWebsite(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function parseOverpass(json: unknown): OsmBusiness[] {
  const data = responseSchema.parse(json);
  const out: OsmBusiness[] = [];
  for (const e of data.elements) {
    const name = e.tags?.name;
    const website = e.tags?.website ? normalizeWebsite(e.tags.website) : null;
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!name || !website || lat === undefined || lon === undefined) continue;
    out.push({ name, website, latitude: lat, longitude: lon });
  }
  return out;
}

export type BBox = { south: number; west: number; north: number; east: number };

const OVERPASS_RETRY_DELAY_MS = 30_000;

function isRetryable(err: unknown): boolean {
  return !(err instanceof HttpError) || err.status === 429 || err.status === 504;
}

async function queryOverpass(query: string): Promise<OsmBusiness[]> {
  const { data } = await fetchJson<unknown>(OVERPASS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
    timeoutMs: 200_000,
  });
  return parseOverpass(data);
}

/** Une seule requête pour toute la zone : bureaux et artisans avec un site web. Réessaie une fois après 30 s en cas d'erreur réseau, 429 ou 504. */
export async function fetchOsmBusinesses(bbox: BBox): Promise<OsmBusiness[]> {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const query = `[out:json][timeout:180];(nwr["website"]["name"]["office"](${b});nwr["website"]["name"]["craft"](${b}););out center tags;`;
  try {
    return await queryOverpass(query);
  } catch (err) {
    if (!isRetryable(err)) throw err;
    await sleep(OVERPASS_RETRY_DELAY_MS);
    return queryOverpass(query);
  }
}

export type NamedCompany = {
  name: string;
  legalName: string;
  tradeNames: string[];
  latitude: number;
  longitude: number;
};

const MAX_OSM_DISTANCE_KM = 0.3;
const OSM_SIMILARITY = 0.85;

export function matchOsmBusiness(company: NamedCompany, businesses: OsmBusiness[]): OsmBusiness | null {
  const names = [company.name, company.legalName, ...company.tradeNames]
    .map(normalizeCompanyName)
    .filter(Boolean);
  let best: { b: OsmBusiness; score: number } | null = null;
  for (const b of businesses) {
    if (distanceKm(company, b) > MAX_OSM_DISTANCE_KM) continue;
    const bn = normalizeCompanyName(b.name);
    const score = Math.max(...names.map((n) => (n === bn ? 1 : trigramSimilarity(n, bn))));
    if (score >= OSM_SIMILARITY && (!best || score > best.score)) best = { b, score };
  }
  return best?.b ?? null;
}
