import { z } from 'zod';
import crawlPathsJson from '../config/crawl-paths.json';
import esnKeywordsJson from '../config/esn-keywords.json';
import ingestJson from '../config/ingest.json';
import techTagsJson from '../config/tech-tags.json';
import type { TechTag } from './types';

const ingestSchema = z.object({
  nafCodes: z.array(z.string().regex(/^\d{2}\.\d{2}[A-Z]$/)).min(1),
  nafLabels: z.record(z.string(), z.string()),
  headcountRanges: z.array(z.string().length(2)).min(1),
  romeCodes: z.array(z.string().regex(/^[A-Z]\d{4}$/)).min(1),
  romeLabels: z.record(z.string(), z.string()),
});

export type IngestConfig = z.infer<typeof ingestSchema>;

const techTagSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  category: z.enum(['language', 'framework', 'database', 'cloud', 'tool', 'domain']),
  aliases: z.array(z.string().min(1)).min(1),
  contextRequired: z.array(z.string().min(1)).optional(),
  fingerprints: z.array(z.string().min(1)).optional(),
});

export const techTagsSchema = z.array(techTagSchema);

export function loadIngestConfig(): IngestConfig {
  return ingestSchema.parse(ingestJson);
}

export function loadTechTags(): TechTag[] {
  return techTagsSchema.parse(techTagsJson);
}

export function loadEsnKeywords(): string[] {
  return z.array(z.string().min(1)).parse(esnKeywordsJson);
}

export function loadCrawlPaths(): string[] {
  return z.array(z.string().startsWith('/')).parse(crawlPathsJson);
}

export const HEADCOUNT_LABELS: Record<string, string> = {
  NN: 'Non renseigné',
  '00': '0 salarié',
  '01': '1 ou 2 salariés',
  '02': '3 à 5 salariés',
  '03': '6 à 9 salariés',
  '11': '10 à 19 salariés',
  '12': '20 à 49 salariés',
  '21': '50 à 99 salariés',
  '22': '100 à 199 salariés',
  '31': '200 à 249 salariés',
  '32': '250 à 499 salariés',
  '41': '500 à 999 salariés',
  '42': '1 000 à 1 999 salariés',
  '51': '2 000 à 4 999 salariés',
  '52': '5 000 à 9 999 salariés',
  '53': '10 000 salariés et plus',
};
