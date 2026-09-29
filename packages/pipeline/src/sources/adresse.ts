import { z } from 'zod';
import { fetchJson } from '../lib/http';

const API = 'https://api-adresse.data.gouv.fr/search/';

const schema = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
      properties: z.object({ label: z.string() }).passthrough(),
    }),
  ),
});

export type GeocodeResult = { label: string; latitude: number; longitude: number };

export function parseGeocode(json: unknown): GeocodeResult | null {
  const data = schema.parse(json);
  const first = data.features[0];
  if (!first) return null;
  const [longitude, latitude] = first.geometry.coordinates;
  return { label: first.properties.label, latitude, longitude };
}

export async function geocode(query: string): Promise<GeocodeResult | null> {
  const url = `${API}?q=${encodeURIComponent(query)}&limit=1`;
  const { data } = await fetchJson<unknown>(url, { timeoutMs: 8_000 });
  return parseGeocode(data);
}
