import type { Detection, TechTag } from '@novi/core';
import { z } from 'zod';
import { optionalEnv } from '../lib/env';
import { fetchJson, HttpError } from '../lib/http';
import { createLimiter } from '../lib/rate-limit';

const API = 'https://api.github.com';

export const repoSchema = z
  .object({
    name: z.string(),
    full_name: z.string(),
    private: z.boolean(),
    fork: z.boolean(),
    archived: z.boolean().default(false),
    language: z.string().nullable(),
    pushed_at: z.string().nullable(),
  })
  .passthrough();

export const reposSchema = z.array(repoSchema);
export type Repo = z.infer<typeof reposSchema>[number];

const limiter = createLimiter(1);

function headers(): Record<string, string> {
  const token = optionalEnv('GITHUB_TOKEN');
  return { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

/** Dépôts publics d'une organisation (ou d'un utilisateur si l'org n'existe pas), jusqu'à 300. */
export async function fetchRepos(org: string): Promise<Repo[]> {
  const out: Repo[] = [];
  for (const kind of ['orgs', 'users'] as const) {
    try {
      for (let page = 1; page <= 3; page++) {
        const url = `${API}/${kind}/${encodeURIComponent(org)}/repos?per_page=100&sort=pushed&page=${page}`;
        const { data } = await limiter(() =>
          fetchJson<unknown>(url, { headers: headers(), timeoutMs: 20_000 }),
        );
        const repos = reposSchema.parse(data);
        out.push(...repos);
        if (repos.length < 100) break;
      }
      return out;
    } catch (err) {
      if (err instanceof HttpError && err.status === 404 && kind === 'orgs') continue;
      throw err;
    }
  }
  return out;
}

const LANGUAGE_ALIASES: Record<string, string> = {
  'c#': 'csharp',
  'c++': 'cpp',
  'objective-c': 'objective-c',
  'jupyter notebook': '',
  html: '',
  css: '',
  scss: '',
  shell: 'bash',
  dockerfile: 'docker',
  hcl: 'terraform',
  vue: 'vue',
  svelte: 'svelte',
};

export function languageToSlug(language: string, tags: TechTag[]): string | null {
  const key = language.toLowerCase();
  if (key in LANGUAGE_ALIASES) return LANGUAGE_ALIASES[key] || null;
  const tag = tags.find((t) => t.slug === key || t.aliases.includes(key));
  return tag?.slug ?? null;
}

export type RepoSummary = {
  detections: Detection[];
  lastPushAt: string | null;
  active: boolean;
  publicRepos: number;
};

const ACTIVE_WITHIN_DAYS = 183;

export function summarizeRepos(repos: Repo[], tags: TechTag[], now = new Date()): RepoSummary {
  const own = repos.filter((r) => !r.fork && !r.archived && !r.private);
  const byLanguage = new Map<string, string[]>();
  let lastPushAt: string | null = null;
  for (const r of own) {
    if (r.pushed_at && (!lastPushAt || r.pushed_at > lastPushAt)) lastPushAt = r.pushed_at;
    if (!r.language) continue;
    const slug = languageToSlug(r.language, tags);
    if (!slug) continue;
    byLanguage.set(slug, [...(byLanguage.get(slug) ?? []), r.name]);
  }
  const detections: Detection[] = [...byLanguage.entries()].map(([slug, names]) => ({
    slug,
    evidence: `${names.length} dépôt${names.length > 1 ? 's' : ''} public${names.length > 1 ? 's' : ''} : ${names.slice(0, 5).join(', ')}`,
    confidence: 0.8,
  }));
  const active =
    !!lastPushAt && now.getTime() - new Date(lastPushAt).getTime() < ACTIVE_WITHIN_DAYS * 86_400_000;
  return { detections, lastPushAt, active, publicRepos: own.length };
}
