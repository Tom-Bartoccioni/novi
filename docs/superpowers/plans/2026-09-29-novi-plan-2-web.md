# Novi V1 — Plan 2 : application web (Next.js)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'app Next.js qui lit la base remplie par le Plan 1 : exploration carte plus liste, fiche entreprise (écran prioritaire), employeurs inconnus, profil, état du pipeline.

**Architecture:** App Router, Server Components qui appellent une couche `src/lib/data.ts` (requêtes Drizzle plus scoring de `@novi/core`), Server Actions dans `src/app/actions.ts` pour les écritures, filtres dans l'URL. MapLibre en composant client. Aucun endpoint API. Le crawl à la demande importe `crawlCompany` de `@novi/pipeline`.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, MapLibre GL 6 avec tuiles OpenFreeMap, Drizzle + better-sqlite3 (via `@novi/db`), Vitest.

**Prérequis :** Plan 1 exécuté, base `data/novi.db` remplie par au moins `ingest sirene` et `discover websites` (pour voir des données à l'écran).

**Spec de référence :** section 7 (écrans), 6 (scoring affiché), 8 (erreurs web) de `docs/superpowers/specs/2026-09-29-novi-v1-design.md`.

**Conventions :** identiques au Plan 1 (commits en français, ligne `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`, commandes depuis la racine).

---

## Structure des fichiers

```
apps/web/
  package.json
  tsconfig.json                    paths @/* -> ./src/*
  next.config.ts                   transpilePackages, serverExternalPackages
  postcss.config.mjs
  vitest.config.ts                 alias @/
  components.json                  généré par shadcn
  src/app/globals.css
  src/app/layout.tsx               nav : Explorer, Employeurs inconnus, Profil, Pipeline
  src/app/page.tsx                 exploration
  src/app/entreprises/[siren]/page.tsx
  src/app/employeurs-inconnus/page.tsx
  src/app/profil/page.tsx
  src/app/pipeline/page.tsx
  src/app/actions.ts               server actions
  src/lib/db.ts                    getDb + getProfile
  src/lib/data.ts                  listCompanies, getCompanyDetail, listUnmatchedOffers, searchCompaniesByName, pipelineOverview, parseFilters
  src/lib/format.ts                formatDistance, formatDate, headcountLabel, linkedinSearchUrl, googleSearchUrl, itineraryUrl
  src/lib/utils.ts                 cn() généré par shadcn
  src/components/ui/*              composants shadcn (button, badge, input, select, textarea, card)
  src/components/company-map.tsx   MapLibre (client)
  src/components/company-list.tsx  liste + survol (client)
  src/components/explore.tsx       coordonne liste et carte (client)
  src/components/filters.tsx       formulaire de filtres (client, met à jour l'URL)
  src/components/tech-badge.tsx
  src/components/score-lines.tsx
  src/components/company-actions.tsx  statut, notes, site web, analyser (client)
  src/components/link-employer.tsx    rattachement (client)
  src/components/profile-form.tsx     (client)
  test/helpers.ts
  test/data.test.ts
```

---

### Task 1 : squelette Next.js, Tailwind, shadcn, navigation

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/vitest.config.ts`
- Create: `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`
- Create: `apps/web/src/lib/db.ts`, `apps/web/src/lib/format.ts`
- Modify: `vitest.config.ts` (racine), `package.json` (racine), `biome.json`

- [ ] **Step 1 : paquet**

`apps/web/package.json` :

```json
{
  "name": "@novi/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
  "dependencies": {
    "@novi/core": "workspace:*",
    "@novi/db": "workspace:*",
    "@novi/pipeline": "workspace:*",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "drizzle-orm": "^0.45.3",
    "lucide-react": "^0.560.0",
    "maplibre-gl": "^6.11.2",
    "next": "^16.3.7",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "tailwind-merge": "^3.3.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.3.3",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "postcss": "^8.5.28",
    "tailwindcss": "^4.3.3",
    "typescript": "^5.9.3",
    "vitest": "^5.0.2"
  }
}
```

Si une version exacte n'existe pas (`lucide-react`, `tailwind-merge`, `class-variance-authority`), prendre la dernière : `npm view <paquet> version`.

`apps/web/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "jsx": "preserve",
    "allowJs": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "types": ["node", "react", "react-dom"]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/web/next.config.ts` :

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@novi/core', '@novi/db', '@novi/pipeline'],
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
```

`apps/web/postcss.config.mjs` :

```js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

`apps/web/vitest.config.ts` :

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

Racine `vitest.config.ts` : `projects: ['packages/*', 'apps/*']`.

Racine `package.json`, ajouter le script `"dev": "pnpm --filter @novi/web dev"` et `"build": "pnpm --filter @novi/web build"`.

`biome.json`, ajouter `"!**/next-env.d.ts"` et `"!**/components/ui"` à `files.includes` (les composants shadcn générés ne sont pas relus par Biome).

Run: `pnpm install`

- [ ] **Step 2 : shadcn**

Run: `cd apps/web && pnpm dlx shadcn@latest init -d && pnpm dlx shadcn@latest add button badge input select textarea card && cd ../..`
Expected: `components.json`, `src/lib/utils.ts`, `src/components/ui/{button,badge,input,select,textarea,card}.tsx` créés, `src/app/globals.css` réécrit avec `@import "tailwindcss";` et les variables de thème. Si l'init demande un choix, prendre les valeurs par défaut (style `new-york`, couleur `neutral`, CSS variables oui). Si l'init échoue faute de `src/app/globals.css`, créer d'abord ce fichier avec la seule ligne `@import "tailwindcss";` puis relancer.

- [ ] **Step 3 : accès base, formatage, layout**

`apps/web/src/lib/db.ts` :

```ts
import { type Db, getDb as getSharedDb, getDefaultProfile } from '@novi/db';

export function db(): Db {
  return getSharedDb();
}

export function getProfile() {
  return getDefaultProfile(db());
}
```

`apps/web/src/lib/format.ts` :

```ts
import { HEADCOUNT_LABELS } from '@novi/core';

export function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function headcountLabel(code: string | null | undefined): string {
  return code ? (HEADCOUNT_LABELS[code] ?? code) : 'Effectif inconnu';
}

export function linkedinSearchUrl(name: string): string {
  return `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(name)}`;
}

export function googleSearchUrl(name: string, city: string | null): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${name} ${city ?? ''}`.trim())}`;
}

export function itineraryUrl(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): string {
  return `https://www.google.com/maps/dir/${from.latitude},${from.longitude}/${to.latitude},${to.longitude}`;
}

export function formatEuros(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}
```

`apps/web/src/app/layout.tsx` :

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: 'Novi', description: 'Entreprises tech autour de chez moi' };

const NAV = [
  { href: '/', label: 'Explorer' },
  { href: '/employeurs-inconnus', label: 'Employeurs inconnus' },
  { href: '/profil', label: 'Profil' },
  { href: '/pipeline', label: 'Pipeline' },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-background text-foreground">
        <header className="border-b">
          <nav className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold">
              Novi
            </Link>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-sm text-muted-foreground hover:text-foreground">
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
```

`apps/web/src/app/page.tsx` (provisoire, remplacé en Task 3) :

```tsx
import { getProfile } from '@/lib/db';

export default function Home() {
  const profile = getProfile();
  return <p>Profil : {profile.homeLabel}, rayon {profile.radiusKm} km.</p>;
}
```

- [ ] **Step 4 : vérifier**

Run: `pnpm dev`
Expected: `▲ Next.js 16.x`, `Local: http://localhost:3000`. Ouvrir l'URL : la nav et « Profil : Nice, rayon 30 km. ». Arrêter avec Ctrl+C. Si `better-sqlite3` provoque une erreur de bundling, vérifier `serverExternalPackages` dans `next.config.ts`.

Run: `pnpm lint:fix && pnpm test`
Expected: Biome sans erreur, tests des paquets toujours verts, projet `apps/web` sans test pour l'instant (accepté par `passWithNoTests`).

- [ ] **Step 5 : commit**

```bash
git add -A
git commit -m "feat(web): squelette Next.js, Tailwind, shadcn/ui, navigation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2 : couche de données de l'app

**Files:**
- Create: `apps/web/src/lib/data.ts`
- Create: `apps/web/test/helpers.ts`, `apps/web/test/data.test.ts`

- [ ] **Step 1 : helpers de test et tests**

`apps/web/test/helpers.ts` :

```ts
import { companies, companyTech, createDb, type Db, jobOffers, migrateAndSeed, replaceSignals } from '@novi/db';

export function seededDb(): Db {
  const db = createDb(':memory:');
  migrateAndSeed(db);
  db.insert(companies)
    .values([
      { siren: '000000001', name: 'Cliken Web', legalName: 'CLIKEN WEB PRO', nafCode: '62.01Z', nafLabel: 'Programmation informatique', headcountRange: '12', siretLocal: 'a', latitude: 43.6197, longitude: 7.0373, city: 'VALBONNE', website: 'https://www.cliken-web.com', careersUrl: 'https://www.cliken-web.com/jobs' },
      { siren: '000000002', name: 'Nice Tech Studio', legalName: 'NICE TECH STUDIO', nafCode: '62.02A', headcountRange: '03', siretLocal: 'b', latitude: 43.7102, longitude: 7.262, city: 'NICE' },
      { siren: '000000003', name: 'Marseille Soft', legalName: 'MARSEILLE SOFT', nafCode: '62.01Z', headcountRange: '12', siretLocal: 'c', latitude: 43.2965, longitude: 5.3698, city: 'MARSEILLE' },
    ])
    .run();
  db.insert(companyTech)
    .values([
      { siren: '000000001', tagSlug: 'react', source: 'site', confidence: 0.7, evidence: 'Stack : React' },
      { siren: '000000001', tagSlug: 'react', source: 'offre', confidence: 0.8, evidence: 'Offre React' },
      { siren: '000000001', tagSlug: 'postgresql', source: 'site', confidence: 0.5, evidence: 'PostgreSQL' },
      { siren: '000000002', tagSlug: 'php', source: 'site', confidence: 0.9, evidence: 'empreinte : x-powered-by: php' },
    ])
    .run();
  db.insert(jobOffers)
    .values([
      { id: 'A', title: 'Dev React', description: 'React et TypeScript', siren: '000000001', employerName: 'CLIKEN WEB', isActive: true, publishedAt: '2026-09-01T00:00:00Z' },
      { id: 'B', title: 'Dev PHP', description: 'Symfony', siren: null, employerName: 'INCONNU SARL', isActive: true, publishedAt: '2026-09-02T00:00:00Z', latitude: 43.7, longitude: 7.26 },
      { id: 'C', title: 'Dev Go', description: 'Go', siren: null, employerName: 'INCONNU SARL', isActive: true, publishedAt: '2026-09-03T00:00:00Z' },
    ])
    .run();
  replaceSignals(db, '000000001', ['recruiting_now'], [{ kind: 'recruiting_now', value: 1, evidence: '1 offre active' }]);
  replaceSignals(db, '000000002', ['esn_suspected'], [{ kind: 'esn_suspected', value: null, evidence: 'régie' }]);
  return db;
}
```

`apps/web/test/data.test.ts` :

```ts
import { companyStatus, getDefaultProfile, profiles } from '@novi/db';
import { describe, expect, it } from 'vitest';
import { availableTechs, getCompanyDetail, listCompanies, listUnmatchedOffers, parseFilters, pipelineOverview, searchCompaniesByName } from '@/lib/data';
import { seededDb } from './helpers';

describe('parseFilters', () => {
  it('reads arrays, booleans and sort from search params', () => {
    expect(parseFilters({ techs: 'react,php', headcount: '12', recruiting: '1', status: 'interested', sort: 'distance', q: 'nice' })).toEqual({
      techs: ['react', 'php'],
      headcount: ['12'],
      recruiting: true,
      status: 'interested',
      sort: 'distance',
      q: 'nice',
    });
    expect(parseFilters({})).toEqual({ techs: [], headcount: [], recruiting: false, status: null, sort: 'score', q: '' });
    expect(parseFilters({ sort: 'bogus' }).sort).toBe('score');
  });
});

describe('listCompanies', () => {
  it('returns companies within the radius, scored and sorted by score', () => {
    const db = seededDb();
    db.update(profiles).set({ skills: ['react', 'typescript'] }).run();
    const profile = getDefaultProfile(db);
    const rows = listCompanies(db, profile, parseFilters({}));
    expect(rows.map((r) => r.name)).toEqual(['Cliken Web', 'Nice Tech Studio']);
    const cliken = rows[0]!;
    expect(cliken.score).toBeGreaterThan(rows[1]!.score);
    expect(cliken.recruiting).toBe(true);
    expect(cliken.topTechs.map((t) => t.slug)).toEqual(['react', 'postgresql']);
    expect(cliken.topTechs[0]?.confidence).toBe(0.8);
    expect(cliken.status).toBe('to_review');
    expect(cliken.distanceKm).toBeGreaterThan(18);
  });
  it('filters by tech, headcount, recruiting, status and query; sorts by distance', () => {
    const db = seededDb();
    const profile = getDefaultProfile(db);
    expect(listCompanies(db, profile, parseFilters({ techs: 'php' })).map((r) => r.name)).toEqual(['Nice Tech Studio']);
    expect(listCompanies(db, profile, parseFilters({ headcount: '12' })).map((r) => r.name)).toEqual(['Cliken Web']);
    expect(listCompanies(db, profile, parseFilters({ recruiting: '1' })).map((r) => r.name)).toEqual(['Cliken Web']);
    expect(listCompanies(db, profile, parseFilters({ q: 'studio' })).map((r) => r.name)).toEqual(['Nice Tech Studio']);
    expect(listCompanies(db, profile, parseFilters({ sort: 'distance' })).map((r) => r.name)).toEqual(['Nice Tech Studio', 'Cliken Web']);
    db.insert(companyStatus).values({ profileId: profile.id, siren: '000000002', status: 'interested' }).run();
    expect(listCompanies(db, profile, parseFilters({ status: 'interested' })).map((r) => r.name)).toEqual(['Nice Tech Studio']);
    expect(listCompanies(db, profile, parseFilters({ status: 'to_review' })).map((r) => r.name)).toEqual(['Cliken Web']);
  });
  it('exposes the tech tags available for filtering, with company counts', () => {
    const db = seededDb();
    expect(availableTechs(db).map((t) => [t.slug, t.count]).sort()).toEqual([
      ['php', 1],
      ['postgresql', 1],
      ['react', 1],
    ]);
  });
});

describe('getCompanyDetail', () => {
  it('groups techs by category with sources and evidence, lists active offers, signals and score lines', () => {
    const db = seededDb();
    db.update(profiles).set({ skills: ['react'] }).run();
    const profile = getDefaultProfile(db);
    const detail = getCompanyDetail(db, profile, '000000001');
    expect(detail).not.toBeNull();
    const d = detail!;
    expect(d.company.name).toBe('Cliken Web');
    expect(d.distanceKm).toBeGreaterThan(18);
    const framework = d.techGroups.find((g) => g.category === 'framework');
    expect(framework?.techs[0]).toMatchObject({ slug: 'react', label: 'React', inProfile: true });
    expect(framework?.techs[0]?.sources.map((s) => s.source).sort()).toEqual(['offre', 'site']);
    expect(d.activeOffers.map((o) => o.id)).toEqual(['A']);
    expect(d.signals.map((s) => s.kind)).toEqual(['recruiting_now']);
    expect(d.score.lines.map((l) => l.label)).toEqual(expect.arrayContaining(['1 techno commune', 'Taille souhaitée (20 à 49 salariés)', '1 offre active correspondant au profil']));
    expect(d.status).toBe('to_review');
    expect(d.notes).toBe('');
    expect(d.links.linkedinSearch).toContain('Cliken');
  });
  it('returns null for an unknown siren', () => {
    const db = seededDb();
    expect(getCompanyDetail(db, getDefaultProfile(db), '999')).toBeNull();
  });
});

describe('unmatched offers, search, overview', () => {
  it('groups unmatched offers by employer', () => {
    const db = seededDb();
    const groups = listUnmatchedOffers(db);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ employerName: 'INCONNU SARL', count: 2 });
    expect(groups[0]?.offers.map((o) => o.id).sort()).toEqual(['B', 'C']);
  });
  it('searches companies by name', () => {
    const db = seededDb();
    expect(searchCompaniesByName(db, 'tech').map((c) => c.siren)).toEqual(['000000002']);
    expect(searchCompaniesByName(db, '')).toEqual([]);
  });
  it('summarises the pipeline state', () => {
    const db = seededDb();
    const o = pipelineOverview(db);
    expect(o.counts).toEqual({ companies: 3, withWebsite: 1, crawled: 0, techDetections: 4, activeOffers: 3, unmatchedOffers: 2 });
    expect(o.runs).toEqual([]);
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `pnpm vitest run apps/web`
Expected: FAIL, module `@/lib/data` introuvable.

- [ ] **Step 3 : implémentation**

`apps/web/src/lib/data.ts` :

```ts
import { type ScoreResult, type TechCategory, detectTechs, distanceKm as computeDistanceKm, loadTechTags, scoreCompany } from '@novi/core';
import {
  type Company,
  type CompanyStatus,
  type Db,
  type Profile,
  companies,
  companiesWithinRadius,
  companyStatus,
  companyTech,
  crawlRuns,
  jobOffers,
  signals,
  techTags,
} from '@novi/db';
import { and, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { googleSearchUrl, itineraryUrl, linkedinSearchUrl } from './format';

export const SORTS = ['score', 'distance', 'size'] as const;
export type Sort = (typeof SORTS)[number];

export type Filters = {
  techs: string[];
  headcount: string[];
  recruiting: boolean;
  status: CompanyStatus | null;
  sort: Sort;
  q: string;
};

const STATUSES: CompanyStatus[] = ['to_review', 'interested', 'contacted', 'rejected', 'ignored'];

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

function list(v: string | string[] | undefined): string[] {
  return first(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseFilters(params: SearchParams): Filters {
  const status = first(params.status) as CompanyStatus;
  const sort = first(params.sort) as Sort;
  return {
    techs: list(params.techs),
    headcount: list(params.headcount),
    recruiting: first(params.recruiting) === '1',
    status: STATUSES.includes(status) ? status : null,
    sort: SORTS.includes(sort) ? sort : 'score',
    q: first(params.q).trim(),
  };
}

export type TechSummary = { slug: string; label: string; category: TechCategory; confidence: number };

export type CompanyListItem = {
  siren: string;
  name: string;
  city: string | null;
  latitude: number;
  longitude: number;
  distanceKm: number;
  headcountRange: string | null;
  topTechs: TechSummary[];
  recruiting: boolean;
  score: number;
  status: CompanyStatus;
};

const tagIndex = new Map(loadTechTags().map((t) => [t.slug, t]));

function bestTechs(rows: { tagSlug: string; confidence: number }[]): TechSummary[] {
  const best = new Map<string, number>();
  for (const r of rows) best.set(r.tagSlug, Math.max(best.get(r.tagSlug) ?? 0, r.confidence));
  return [...best.entries()]
    .map(([slug, confidence]) => {
      const tag = tagIndex.get(slug);
      return { slug, label: tag?.label ?? slug, category: tag?.category ?? 'tool', confidence };
    })
    .sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label));
}

function scoreFor(db: Db, profile: Profile, company: Company, distanceKm: number, techs: { tagSlug: string; confidence: number }[]): ScoreResult {
  const tags = loadTechTags();
  const offers = db
    .select({ title: jobOffers.title, description: jobOffers.description })
    .from(jobOffers)
    .where(and(eq(jobOffers.siren, company.siren), eq(jobOffers.isActive, true)))
    .all();
  const sig = db.select({ kind: signals.kind, value: signals.value }).from(signals).where(eq(signals.siren, company.siren)).all();
  return scoreCompany(
    { skills: profile.skills, radiusKm: profile.radiusKm, headcountRanges: profile.headcountRanges },
    {
      headcountRange: company.headcountRange,
      techs: techs.map((t) => ({ slug: t.tagSlug, confidence: t.confidence })),
      activeOffers: offers.map((o) => ({ techSlugs: detectTechs(`${o.title}\n${o.description ?? ''}`, tags, 0.8).map((d) => d.slug) })),
      signals: sig,
    },
    distanceKm,
  );
}

export function listCompanies(db: Db, profile: Profile, filters: Filters): CompanyListItem[] {
  const inRadius = companiesWithinRadius(db, { latitude: profile.homeLatitude, longitude: profile.homeLongitude }, profile.radiusKm);
  const techRows = db.select({ siren: companyTech.siren, tagSlug: companyTech.tagSlug, confidence: companyTech.confidence }).from(companyTech).all();
  const techBySiren = new Map<string, { tagSlug: string; confidence: number }[]>();
  for (const r of techRows) techBySiren.set(r.siren, [...(techBySiren.get(r.siren) ?? []), r]);
  const recruitingSirens = new Set(
    db.select({ siren: jobOffers.siren }).from(jobOffers).where(and(eq(jobOffers.isActive, true), isNotNull(jobOffers.siren))).all().map((r) => r.siren as string),
  );
  const statusBySiren = new Map(
    db.select({ siren: companyStatus.siren, status: companyStatus.status }).from(companyStatus).where(eq(companyStatus.profileId, profile.id)).all().map((r) => [r.siren, r.status]),
  );
  const q = filters.q.toLowerCase();

  const items: CompanyListItem[] = [];
  for (const c of inRadius) {
    const techs = techBySiren.get(c.siren) ?? [];
    const status = statusBySiren.get(c.siren) ?? 'to_review';
    const recruiting = recruitingSirens.has(c.siren);
    if (filters.techs.length > 0 && !filters.techs.every((slug) => techs.some((t) => t.tagSlug === slug))) continue;
    if (filters.headcount.length > 0 && !filters.headcount.includes(c.headcountRange ?? '')) continue;
    if (filters.recruiting && !recruiting) continue;
    if (filters.status && status !== filters.status) continue;
    if (q && !`${c.name} ${c.legalName} ${c.city ?? ''}`.toLowerCase().includes(q)) continue;
    const { distanceKm, ...company } = c;
    items.push({
      siren: c.siren,
      name: c.name,
      city: c.city,
      latitude: c.latitude,
      longitude: c.longitude,
      distanceKm,
      headcountRange: c.headcountRange,
      topTechs: bestTechs(techs).slice(0, 3),
      recruiting,
      score: scoreFor(db, profile, company, distanceKm, techs).score,
      status,
    });
  }
  const sizeRank = (r: string | null) => (r ? Number.parseInt(r, 10) || 0 : -1);
  items.sort((a, b) => {
    if (filters.sort === 'distance') return a.distanceKm - b.distanceKm;
    if (filters.sort === 'size') return sizeRank(b.headcountRange) - sizeRank(a.headcountRange) || b.score - a.score;
    return b.score - a.score || a.distanceKm - b.distanceKm;
  });
  return items;
}

/** Technos présentes dans au moins une entreprise, pour le filtre. */
export function availableTechs(db: Db): { slug: string; label: string; count: number }[] {
  return db
    .select({ slug: companyTech.tagSlug, label: techTags.label, count: sql<number>`count(distinct ${companyTech.siren})` })
    .from(companyTech)
    .innerJoin(techTags, eq(techTags.slug, companyTech.tagSlug))
    .groupBy(companyTech.tagSlug, techTags.label)
    .orderBy(desc(sql`count(distinct ${companyTech.siren})`))
    .all();
}

export type TechDetail = {
  slug: string;
  label: string;
  inProfile: boolean;
  sources: { source: string; confidence: number; evidence: string | null; detectedAt: string }[];
};

export type TechGroup = { category: TechCategory; techs: TechDetail[] };

export type CompanyDetail = {
  company: Company;
  distanceKm: number;
  techGroups: TechGroup[];
  activeOffers: { id: string; title: string; contractType: string | null; publishedAt: string | null; url: string | null }[];
  signals: { kind: string; value: number | null; evidence: string | null; detectedAt: string }[];
  score: ScoreResult;
  status: CompanyStatus;
  notes: string;
  links: { linkedinSearch: string; googleSearch: string; itinerary: string };
};

const CATEGORY_ORDER: TechCategory[] = ['language', 'framework', 'database', 'cloud', 'tool', 'domain'];

export function getCompanyDetail(db: Db, profile: Profile, siren: string): CompanyDetail | null {
  const company = db.select().from(companies).where(eq(companies.siren, siren)).get();
  if (!company) return null;
  const distanceKm = computeDistanceKm({ latitude: profile.homeLatitude, longitude: profile.homeLongitude }, company);
  const techRows = db.select().from(companyTech).where(eq(companyTech.siren, siren)).all();
  const skills = new Set(profile.skills);
  const byCategory = new Map<TechCategory, Map<string, TechDetail>>();
  for (const r of techRows) {
    const tag = tagIndex.get(r.tagSlug);
    const category = tag?.category ?? 'tool';
    const group = byCategory.get(category) ?? new Map<string, TechDetail>();
    const detail = group.get(r.tagSlug) ?? { slug: r.tagSlug, label: tag?.label ?? r.tagSlug, inProfile: skills.has(r.tagSlug), sources: [] };
    detail.sources.push({ source: r.source, confidence: r.confidence, evidence: r.evidence, detectedAt: r.detectedAt });
    group.set(r.tagSlug, detail);
    byCategory.set(category, group);
  }
  const techGroups: TechGroup[] = CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => ({
    category,
    techs: [...(byCategory.get(category)?.values() ?? [])].sort(
      (a, b) => Number(b.inProfile) - Number(a.inProfile) || Math.max(...b.sources.map((s) => s.confidence)) - Math.max(...a.sources.map((s) => s.confidence)),
    ),
  }));
  const activeOffers = db
    .select({ id: jobOffers.id, title: jobOffers.title, contractType: jobOffers.contractType, publishedAt: jobOffers.publishedAt, url: jobOffers.url })
    .from(jobOffers)
    .where(and(eq(jobOffers.siren, siren), eq(jobOffers.isActive, true)))
    .orderBy(desc(jobOffers.publishedAt))
    .all();
  const sig = db
    .select({ kind: signals.kind, value: signals.value, evidence: signals.evidence, detectedAt: signals.detectedAt })
    .from(signals)
    .where(eq(signals.siren, siren))
    .orderBy(desc(signals.detectedAt))
    .all();
  const status = db.select().from(companyStatus).where(and(eq(companyStatus.profileId, profile.id), eq(companyStatus.siren, siren))).get();
  return {
    company,
    distanceKm,
    techGroups,
    activeOffers,
    signals: sig,
    score: scoreFor(db, profile, company, distanceKm, techRows),
    status: status?.status ?? 'to_review',
    notes: status?.notes ?? '',
    links: {
      linkedinSearch: linkedinSearchUrl(company.name),
      googleSearch: googleSearchUrl(company.name, company.city),
      itinerary: itineraryUrl({ latitude: profile.homeLatitude, longitude: profile.homeLongitude }, company),
    },
  };
}

export type UnmatchedGroup = {
  employerName: string;
  count: number;
  offers: { id: string; title: string; city: string | null; publishedAt: string | null; url: string | null }[];
};

export function listUnmatchedOffers(db: Db): UnmatchedGroup[] {
  const rows = db
    .select({ id: jobOffers.id, title: jobOffers.title, city: jobOffers.city, publishedAt: jobOffers.publishedAt, url: jobOffers.url, employerName: jobOffers.employerName })
    .from(jobOffers)
    .where(and(isNull(jobOffers.siren), eq(jobOffers.isActive, true), isNotNull(jobOffers.employerName)))
    .orderBy(desc(jobOffers.publishedAt))
    .all();
  const groups = new Map<string, UnmatchedGroup>();
  for (const r of rows) {
    const name = r.employerName as string;
    const g = groups.get(name) ?? { employerName: name, count: 0, offers: [] };
    g.count += 1;
    g.offers.push({ id: r.id, title: r.title, city: r.city, publishedAt: r.publishedAt, url: r.url });
    groups.set(name, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.employerName.localeCompare(b.employerName));
}

export function searchCompaniesByName(db: Db, q: string): { siren: string; name: string; city: string | null }[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return db
    .select({ siren: companies.siren, name: companies.name, city: companies.city })
    .from(companies)
    .where(sql`lower(${companies.name}) like ${`%${needle}%`} or lower(${companies.legalName}) like ${`%${needle}%`}`)
    .orderBy(companies.name)
    .limit(20)
    .all();
}

export function pipelineOverview(db: Db) {
  const one = (q: { get: () => { c: number } | undefined }) => q.get()?.c ?? 0;
  return {
    runs: db.select().from(crawlRuns).orderBy(desc(crawlRuns.id)).limit(20).all(),
    counts: {
      companies: one(db.select({ c: count() }).from(companies)),
      withWebsite: one(db.select({ c: count() }).from(companies).where(isNotNull(companies.website))),
      crawled: one(db.select({ c: count() }).from(companies).where(isNotNull(companies.lastCrawledAt))),
      techDetections: one(db.select({ c: count() }).from(companyTech)),
      activeOffers: one(db.select({ c: count() }).from(jobOffers).where(eq(jobOffers.isActive, true))),
      unmatchedOffers: one(db.select({ c: count() }).from(jobOffers).where(and(eq(jobOffers.isActive, true), isNull(jobOffers.siren)))),
    },
  };
}
```

- [ ] **Step 4 : vérifier**

Run: `pnpm vitest run apps/web`
Expected: tous les tests verts. Pour « Cliken Web » : distance Nice → Valbonne environ 19 km, technos react (0.8) et postgresql (0.5), offre active A, statut par défaut `to_review`.

- [ ] **Step 5 : commit**

```bash
git add apps/web
git commit -m "feat(web): couche de données (liste filtrée et scorée, fiche, employeurs inconnus, aperçu pipeline)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3 : écran Exploration (liste, carte, filtres)

**Files:**
- Create: `apps/web/src/components/tech-badge.tsx`, `apps/web/src/components/company-map.tsx`, `apps/web/src/components/company-list.tsx`, `apps/web/src/components/explore.tsx`, `apps/web/src/components/filters.tsx`
- Modify: `apps/web/src/app/page.tsx`

Pas de test unitaire de rendu (spec section 9) : la vérification est visuelle, avec la base réelle.

- [ ] **Step 1 : badge techno**

`apps/web/src/components/tech-badge.tsx` :

```tsx
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function TechBadge({ label, confidence, highlighted, title }: { label: string; confidence?: number; highlighted?: boolean; title?: string }) {
  return (
    <Badge variant={highlighted ? 'default' : 'secondary'} title={title} className={cn('font-normal', confidence !== undefined && confidence < 0.6 && 'opacity-70')}>
      {label}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { to_review: 'À voir', interested: 'Intéressée', contacted: 'Contactée', rejected: 'Refusée', ignored: 'Ignorée' };
  if (status === 'to_review') return null;
  return <Badge variant="outline">{labels[status] ?? status}</Badge>;
}
```

- [ ] **Step 2 : carte MapLibre (client)**

`apps/web/src/components/company-map.tsx` :

```tsx
'use client';

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import type { CompanyListItem } from '@/lib/data';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export type MapProps = {
  home: { latitude: number; longitude: number; radiusKm: number };
  companies: CompanyListItem[];
  highlighted: string | null;
  onHover: (siren: string | null) => void;
  onSelect: (siren: string) => void;
};

export function CompanyMap({ home, companies, highlighted, onHover, onSelect }: MapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());

  useEffect(() => {
    if (!container.current || map.current) return;
    const m = new maplibregl.Map({ container: container.current, style: STYLE_URL, center: [home.longitude, home.latitude], zoom: 10 });
    m.addControl(new maplibregl.NavigationControl(), 'top-right');
    new maplibregl.Marker({ color: '#111' }).setLngLat([home.longitude, home.latitude]).setPopup(new maplibregl.Popup().setText('Chez moi')).addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, [home.latitude, home.longitude]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const marker of markers.current.values()) marker.remove();
    markers.current.clear();
    for (const c of companies) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'novi-marker';
      el.style.cssText = 'width:14px;height:14px;border-radius:9999px;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.3);cursor:pointer;';
      el.style.background = c.recruiting ? '#16a34a' : '#2563eb';
      el.title = `${c.name} · score ${c.score}`;
      el.addEventListener('mouseenter', () => onHover(c.siren));
      el.addEventListener('mouseleave', () => onHover(null));
      el.addEventListener('click', () => onSelect(c.siren));
      markers.current.set(c.siren, new maplibregl.Marker({ element: el }).setLngLat([c.longitude, c.latitude]).addTo(m));
    }
  }, [companies, onHover, onSelect]);

  useEffect(() => {
    for (const [siren, marker] of markers.current) {
      const el = marker.getElement();
      const on = siren === highlighted;
      el.style.transform = `${el.style.transform.replace(/ scale\([^)]*\)/, '')}${on ? ' scale(1.6)' : ''}`;
      el.style.zIndex = on ? '10' : '1';
    }
  }, [highlighted]);

  return <div ref={container} className="h-[420px] w-full rounded-lg border lg:h-[calc(100vh-8rem)]" />;
}
```

- [ ] **Step 3 : liste (client)**

`apps/web/src/components/company-list.tsx` :

```tsx
'use client';

import Link from 'next/link';
import { StatusBadge, TechBadge } from '@/components/tech-badge';
import type { CompanyListItem } from '@/lib/data';
import { formatDistance, headcountLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

export function CompanyList({ companies, highlighted, onHover }: { companies: CompanyListItem[]; highlighted: string | null; onHover: (siren: string | null) => void }) {
  if (companies.length === 0) return <p className="text-sm text-muted-foreground">Aucune entreprise ne correspond à ces filtres.</p>;
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
            <div className="shrink-0 rounded-md bg-muted px-2 py-1 text-sm font-semibold tabular-nums" title="Score">
              {c.score}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4 : filtres (client, écrivent dans l'URL)**

`apps/web/src/components/filters.tsx` :

```tsx
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { HEADCOUNT_LABELS } from '@novi/core';
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

export function FiltersBar({ filters, techs, headcountCodes }: { filters: Filters; techs: { slug: string; label: string; count: number }[]; headcountCodes: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}?${next.toString()}`);
  };
  const toggleIn = (key: 'techs' | 'headcount', value: string) => {
    const current = filters[key];
    const nextList = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    update({ [key]: nextList.join(',') });
  };

  return (
    <div className="space-y-3 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Nom ou ville" defaultValue={filters.q} onChange={(e) => update({ q: e.target.value })} className="h-8 w-48" />
        <select className="h-8 rounded-md border bg-background px-2" value={filters.sort} onChange={(e) => update({ sort: e.target.value })}>
          <option value="score">Tri : score</option>
          <option value="distance">Tri : distance</option>
          <option value="size">Tri : taille</option>
        </select>
        <select className="h-8 rounded-md border bg-background px-2" value={filters.status ?? ''} onChange={(e) => update({ status: e.target.value })}>
          {STATUS_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={filters.recruiting} onChange={(e) => update({ recruiting: e.target.checked ? '1' : null })} />
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
      <div className="flex flex-wrap gap-1">
        {techs.slice(0, 40).map((t) => (
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
```

- [ ] **Step 5 : coordination liste et carte (client)**

`apps/web/src/components/explore.tsx` :

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { CompanyList } from '@/components/company-list';
import { CompanyMap } from '@/components/company-map';
import type { CompanyListItem } from '@/lib/data';

export function Explore({ companies, home }: { companies: CompanyListItem[]; home: { latitude: number; longitude: number; radiusKm: number } }) {
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
        <CompanyMap home={home} companies={companies} highlighted={highlighted} onHover={onHover} onSelect={onSelect} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6 : page**

`apps/web/src/app/page.tsx` :

```tsx
import { loadIngestConfig } from '@novi/core';
import { Explore } from '@/components/explore';
import { FiltersBar } from '@/components/filters';
import { availableTechs, listCompanies, parseFilters } from '@/lib/data';
import { db, getProfile } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseFilters(await searchParams);
  const profile = getProfile();
  const companies = listCompanies(db(), profile, filters);
  const techs = availableTechs(db());
  const noData = techs.length === 0 && companies.length === 0 && filters.techs.length === 0 && !filters.q;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Autour de {profile.homeLabel}, {profile.radiusKm} km</h1>
        {profile.skills.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Aucune compétence dans le profil : le score ignore les technos. <a className="underline" href="/profil">Compléter le profil</a>.
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
          <FiltersBar filters={filters} techs={techs} headcountCodes={loadIngestConfig().headcountRanges} />
          <Explore companies={companies} home={{ latitude: profile.homeLatitude, longitude: profile.homeLongitude, radiusKm: profile.radiusKm }} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 7 : vérifier visuellement**

Run: `pnpm dev`, ouvrir `http://localhost:3000`.
Expected :
- Titre « Autour de Nice, 30 km », barre de filtres, liste à gauche et carte à droite avec le marqueur noir « Chez moi » et des points bleus (verts pour celles qui recrutent).
- Survoler une ligne agrandit son point ; cliquer un point ouvre la fiche (404 attendu jusqu'à la Task 4).
- Cocher une techno filtre la liste et met à jour l'URL (`?techs=react`).
- Sur une fenêtre étroite (moins de 1024 px), la carte passe au-dessus de la liste.
- Avec une base vide (`DATABASE_URL=file:./data/vide.db pnpm dev` après `pnpm db:migrate` sur ce fichier), l'état vide affiche la commande à lancer.

Si la carte est blanche : vérifier dans la console réseau que `tiles.openfreemap.org` répond, et que le CSS `maplibre-gl.css` est bien importé.

- [ ] **Step 8 : commit**

```bash
git add apps/web
git commit -m "feat(web): écran d'exploration avec liste, carte MapLibre et filtres dans l'URL

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4 : fiche entreprise et actions (écran prioritaire)

**Files:**
- Create: `apps/web/src/lib/mutations.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/components/score-lines.tsx`, `apps/web/src/components/company-actions.tsx`
- Create: `apps/web/src/app/entreprises/[siren]/page.tsx`
- Test: `apps/web/test/actions.test.ts`

- [ ] **Step 1 : tests des fonctions d'écriture**

Les Server Actions (`actions.ts`, fichier `'use server'` dont Next.js exige que toutes les exports soient asynchrones) délèguent à des fonctions synchrones testables dans `lib/mutations.ts`, préfixées par `apply`.

`apps/web/test/actions.test.ts` :

```ts
import { companies, companyStatus, employerAliases, getDefaultProfile, jobOffers } from '@novi/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { applyLinkEmployer, applyNotes, applyProfile, applyStatus, applyWebsite } from '@/lib/mutations';
import { seededDb } from './helpers';

describe('status and notes', () => {
  it('upserts the status row for the profile', () => {
    const db = seededDb();
    const profile = getDefaultProfile(db);
    applyStatus(db, profile.id, '000000001', 'interested');
    applyStatus(db, profile.id, '000000001', 'contacted');
    applyNotes(db, profile.id, '000000001', 'Appeler lundi');
    const row = db.select().from(companyStatus).where(eq(companyStatus.siren, '000000001')).get();
    expect(row).toMatchObject({ status: 'contacted', notes: 'Appeler lundi' });
  });
  it('rejects an unknown status', () => {
    const db = seededDb();
    expect(() => applyStatus(db, getDefaultProfile(db).id, '000000001', 'bogus')).toThrow(/statut/i);
  });
});

describe('website', () => {
  it('stores a normalized manual website', () => {
    const db = seededDb();
    applyWebsite(db, '000000002', 'nicetech.fr');
    expect(db.select().from(companies).where(eq(companies.siren, '000000002')).get()).toMatchObject({ website: 'https://nicetech.fr', websiteSource: 'manuel', websiteConfidence: 1 });
  });
  it('rejects garbage', () => {
    const db = seededDb();
    expect(() => applyWebsite(db, '000000002', 'pas une url')).toThrow(/URL/);
  });
});

describe('link employer', () => {
  it('links all unmatched offers of the employer, saves the alias and writes techs', () => {
    const db = seededDb();
    const result = applyLinkEmployer(db, 'INCONNU SARL', '000000002');
    expect(result.linked).toBe(2);
    expect(db.select().from(jobOffers).where(eq(jobOffers.siren, '000000002')).all().map((o) => o.id).sort()).toEqual(['B', 'C']);
    expect(db.select().from(employerAliases).get()?.employerNameNormalized).toBe('inconnu');
  });
});

describe('profile', () => {
  it('updates radius, skills and headcount ranges, keeping unknown skills out', () => {
    const db = seededDb();
    const profile = getDefaultProfile(db);
    applyProfile(db, profile.id, { homeLabel: 'Antibes', homeLatitude: 43.58, homeLongitude: 7.12, radiusKm: 20, skills: ['react', 'inexistant'], headcountRanges: ['11', '12'] });
    expect(getDefaultProfile(db)).toMatchObject({ homeLabel: 'Antibes', radiusKm: 20, skills: ['react'], headcountRanges: ['11', '12'] });
  });
  it('rejects a radius outside 1..200', () => {
    const db = seededDb();
    const profile = getDefaultProfile(db);
    expect(() => applyProfile(db, profile.id, { homeLabel: 'x', homeLatitude: 0, homeLongitude: 0, radiusKm: 0, skills: [], headcountRanges: [] })).toThrow(/rayon/i);
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `pnpm vitest run apps/web/test/actions.test.ts`
Expected: FAIL, module `@/lib/mutations` introuvable.

- [ ] **Step 3 : mutations et actions**

`apps/web/src/lib/mutations.ts` (fonctions synchrones, sans directive) :

```ts
import { detectTechs, loadTechTags } from '@novi/core';
import { COMPANY_STATUSES, type CompanyStatus, type Db, companies, companyStatus, jobOffers, profiles, saveAlias, upsertCompanyTech } from '@novi/db';
import { OFFER_TECH_CONFIDENCE } from '@novi/pipeline';
import { and, eq, isNull } from 'drizzle-orm';

export function applyStatus(database: Db, profileId: number, siren: string, status: string): void {
  if (!(COMPANY_STATUSES as readonly string[]).includes(status)) throw new Error(`Statut inconnu : ${status}`);
  database
    .insert(companyStatus)
    .values({ profileId, siren, status: status as CompanyStatus })
    .onConflictDoUpdate({ target: [companyStatus.profileId, companyStatus.siren], set: { status: status as CompanyStatus } })
    .run();
}

export function applyNotes(database: Db, profileId: number, siren: string, notes: string): void {
  database
    .insert(companyStatus)
    .values({ profileId, siren, notes })
    .onConflictDoUpdate({ target: [companyStatus.profileId, companyStatus.siren], set: { notes } })
    .run();
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('URL invalide');
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) throw new Error('URL invalide');
  return url.toString().replace(/\/$/, '');
}

export function applyWebsite(database: Db, siren: string, website: string): void {
  const url = normalizeUrl(website);
  database.update(companies).set({ website: url, websiteSource: 'manuel', websiteConfidence: 1 }).where(eq(companies.siren, siren)).run();
}

export function applyLinkEmployer(database: Db, employerName: string, siren: string): { linked: number } {
  const tags = loadTechTags();
  const offers = database.select().from(jobOffers).where(and(isNull(jobOffers.siren), eq(jobOffers.employerName, employerName))).all();
  database.transaction((tx) => {
    for (const o of offers) tx.update(jobOffers).set({ siren }).where(eq(jobOffers.id, o.id)).run();
  });
  for (const o of offers) upsertCompanyTech(database, siren, 'offre', detectTechs(`${o.title}\n${o.description ?? ''}`, tags, OFFER_TECH_CONFIDENCE));
  saveAlias(database, employerName, siren);
  return { linked: offers.length };
}

export type ProfileInput = { homeLabel: string; homeLatitude: number; homeLongitude: number; radiusKm: number; skills: string[]; headcountRanges: string[] };

export function applyProfile(database: Db, profileId: number, input: ProfileInput): void {
  if (!(input.radiusKm >= 1 && input.radiusKm <= 200)) throw new Error('Le rayon doit être entre 1 et 200 km');
  if (!input.homeLabel.trim()) throw new Error('Adresse manquante');
  const known = new Set(loadTechTags().map((t) => t.slug));
  database
    .update(profiles)
    .set({
      homeLabel: input.homeLabel.trim(),
      homeLatitude: input.homeLatitude,
      homeLongitude: input.homeLongitude,
      radiusKm: input.radiusKm,
      skills: input.skills.filter((s) => known.has(s)),
      headcountRanges: input.headcountRanges,
    })
    .where(eq(profiles.id, profileId))
    .run();
}
```

`apps/web/src/app/actions.ts` :

```ts
'use server';

import { crawlCompany, geocode } from '@novi/pipeline';
import { revalidatePath } from 'next/cache';
import { db, getProfile } from '@/lib/db';
import { applyLinkEmployer, applyNotes, applyProfile, applyStatus, applyWebsite, type ProfileInput } from '@/lib/mutations';

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function fail(err: unknown): ActionResult {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

export async function updateStatus(siren: string, status: string): Promise<ActionResult> {
  try {
    applyStatus(db(), getProfile().id, siren, status);
    revalidatePath(`/entreprises/${siren}`);
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function updateNotes(siren: string, notes: string): Promise<ActionResult> {
  try {
    applyNotes(db(), getProfile().id, siren, notes);
    revalidatePath(`/entreprises/${siren}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function updateWebsite(siren: string, website: string): Promise<ActionResult> {
  try {
    applyWebsite(db(), siren, website);
    revalidatePath(`/entreprises/${siren}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const CRAWL_TIMEOUT_MS = 60_000;

export async function analyzeWebsite(siren: string): Promise<ActionResult> {
  try {
    const analysis = await Promise.race([
      crawlCompany(db(), siren),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Délai dépassé (60 s)')), CRAWL_TIMEOUT_MS)),
    ]);
    revalidatePath(`/entreprises/${siren}`);
    revalidatePath('/');
    return { ok: true, message: `${analysis.detections.length} technos détectées${analysis.careersUrl ? ', page carrière trouvée' : ''}` };
  } catch (err) {
    return fail(err);
  }
}

export async function linkEmployer(employerName: string, siren: string): Promise<ActionResult> {
  try {
    const { linked } = applyLinkEmployer(db(), employerName, siren);
    revalidatePath('/employeurs-inconnus');
    revalidatePath(`/entreprises/${siren}`);
    return { ok: true, message: `${linked} offre${linked > 1 ? 's' : ''} rattachée${linked > 1 ? 's' : ''}` };
  } catch (err) {
    return fail(err);
  }
}

export async function geocodeAddress(query: string): Promise<{ ok: true; label: string; latitude: number; longitude: number } | { ok: false; error: string }> {
  try {
    const r = await geocode(query);
    if (!r) return { ok: false, error: 'Adresse introuvable' };
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateProfile(input: ProfileInput): Promise<ActionResult> {
  try {
    applyProfile(db(), getProfile().id, input);
    revalidatePath('/');
    revalidatePath('/profil');
    return { ok: true, message: 'Profil enregistré' };
  } catch (err) {
    return fail(err);
  }
}
```

Run: `pnpm vitest run apps/web/test/actions.test.ts`
Expected: tests verts. Pour « INCONNU SARL » : `normalizeCompanyName` retire `sarl`, l'alias stocké est `inconnu`.

- [ ] **Step 4 : composants de la fiche**

`apps/web/src/components/score-lines.tsx` :

```tsx
import type { ScoreResult } from '@novi/core';

export function ScoreLines({ score }: { score: ScoreResult }) {
  return (
    <div>
      <p className="text-3xl font-semibold tabular-nums">{score.score}</p>
      {score.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun critère ne s'applique.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {score.lines.map((l) => (
            <li key={l.label} className="flex justify-between gap-4">
              <span>{l.label}</span>
              <span className={`tabular-nums ${l.points < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                {l.points > 0 ? '+' : ''}
                {l.points}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

`apps/web/src/components/company-actions.tsx` :

```tsx
'use client';

import { COMPANY_STATUSES } from '@novi/db';
import { useState, useTransition } from 'react';
import { analyzeWebsite, updateNotes, updateStatus, updateWebsite } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const LABELS: Record<string, string> = { to_review: 'À voir', interested: 'Intéressée', contacted: 'Contactée', rejected: 'Refusée', ignored: 'Ignorée' };

export function StatusSelect({ siren, status }: { siren: string; status: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        defaultValue={status}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const r = await updateStatus(siren, e.target.value);
            setError(r.ok ? null : r.error);
          })
        }
      >
        {COMPANY_STATUSES.map((s) => (
          <option key={s} value={s}>
            {LABELS[s]}
          </option>
        ))}
      </select>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}

export function NotesField({ siren, notes }: { siren: string; notes: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (
    <div className="space-y-1">
      <Textarea
        defaultValue={notes}
        placeholder="Notes personnelles (contact, impressions, relances…)"
        rows={5}
        onChange={(e) => {
          const value = e.target.value;
          setState('saving');
          clearTimeout(timer);
          timer = setTimeout(async () => {
            const r = await updateNotes(siren, value);
            if (r.ok) setState('saved');
            else {
              setState('error');
              setError(r.error);
            }
          }, 600);
        }}
      />
      <p className="text-xs text-muted-foreground">
        {state === 'saving' && 'Enregistrement…'}
        {state === 'saved' && 'Enregistré'}
        {state === 'error' && <span className="text-destructive">{error}</span>}
      </p>
    </div>
  );
}

export function WebsiteField({ siren, website, canAnalyze }: { siren: string; website: string | null; canAnalyze: boolean }) {
  const [value, setValue] = useState(website ?? '');
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await updateWebsite(siren, value);
            setMessage(r.ok ? { kind: 'ok', text: 'Site enregistré' } : { kind: 'error', text: r.error });
          });
        }}
      >
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://exemple.fr" className="h-9" />
        <Button type="submit" variant="outline" disabled={pending || !value.trim()}>
          Enregistrer
        </Button>
        <Button
          type="button"
          disabled={pending || !canAnalyze}
          onClick={() =>
            start(async () => {
              setMessage({ kind: 'ok', text: 'Analyse en cours (jusqu’à 60 s)…' });
              const r = await analyzeWebsite(siren);
              setMessage(r.ok ? { kind: 'ok', text: r.message ?? 'Analyse terminée' } : { kind: 'error', text: r.error });
            })
          }
        >
          Analyser le site
        </Button>
      </form>
      {message && <p className={`text-sm ${message.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{message.text}</p>}
    </div>
  );
}
```

- [ ] **Step 5 : page**

`apps/web/src/app/entreprises/[siren]/page.tsx` :

```tsx
import { loadIngestConfig } from '@novi/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NotesField, StatusSelect, WebsiteField } from '@/components/company-actions';
import { ScoreLines } from '@/components/score-lines';
import { TechBadge } from '@/components/tech-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCompanyDetail } from '@/lib/data';
import { db, getProfile } from '@/lib/db';
import { formatDate, formatDistance, formatEuros, headcountLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

const CATEGORY_LABELS: Record<string, string> = { language: 'Langages', framework: 'Frameworks', database: 'Bases de données', cloud: 'Cloud et hébergement', tool: 'Outils', domain: 'Domaines' };
const SOURCE_LABELS: Record<string, string> = { offre: 'offre', site: 'site web', github: 'GitHub', manuel: 'manuel' };
const SIGNAL_LABELS: Record<string, string> = {
  recruiting_now: 'Recrute actuellement',
  hired_last_12_months: 'A recruté sur 12 mois',
  careers_page_found: 'Page carrière',
  github_active: 'GitHub actif',
  revenue_growth: 'Évolution du chiffre d’affaires',
  esn_suspected: 'ESN suspectée',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">{children}</CardContent>
    </Card>
  );
}

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  );
}

export default async function CompanyPage({ params }: { params: Promise<{ siren: string }> }) {
  const { siren } = await params;
  const profile = getProfile();
  const detail = getCompanyDetail(db(), profile, siren);
  if (!detail) notFound();
  const { company, distanceKm, techGroups, activeOffers, signals, score, status, notes, links } = detail;
  const nafLabel = company.nafLabel ?? loadIngestConfig().nafLabels[company.nafCode] ?? company.nafCode;
  const financeYears = Object.entries(company.finances ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← Explorer
        </Link>
        <h1 className="text-2xl font-semibold">{company.name}</h1>
        {company.legalName !== company.name && <p className="text-sm text-muted-foreground">{company.legalName}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Identité">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Activité</dt>
              <dd>{nafLabel} ({company.nafCode})</dd>
              <dt className="text-muted-foreground">Effectif</dt>
              <dd>{headcountLabel(company.headcountRange)}{company.headcountYear ? ` (${company.headcountYear})` : ''}{company.companyCategory ? ` · ${company.companyCategory}` : ''}</dd>
              <dt className="text-muted-foreground">Création</dt>
              <dd>{formatDate(company.foundedAt)}</dd>
              <dt className="text-muted-foreground">Adresse</dt>
              <dd>
                {company.address ?? '—'} {company.postalCode} {company.city}
                {!company.headquartersInZone && <span className="ml-2 text-xs text-muted-foreground">(établissement local, siège ailleurs)</span>}
              </dd>
              <dt className="text-muted-foreground">Distance</dt>
              <dd>{formatDistance(distanceKm)} depuis {profile.homeLabel} · <External href={links.itinerary}>itinéraire</External></dd>
            </dl>
            {company.description && <p className="mt-3 text-muted-foreground">{company.description}</p>}
          </Section>

          <Section title="Présence en ligne">
            <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
              {company.website && <li><External href={company.website}>Site web</External> <span className="text-xs text-muted-foreground">({company.websiteSource})</span></li>}
              {company.careersUrl && <li><External href={company.careersUrl}>Page carrière</External></li>}
              {company.githubOrg && <li><External href={`https://github.com/${company.githubOrg}`}>GitHub</External></li>}
              {company.linkedinUrl ? <li><External href={company.linkedinUrl}>LinkedIn</External></li> : <li><External href={links.linkedinSearch}>Chercher sur LinkedIn</External></li>}
              <li><External href={links.googleSearch}>Chercher sur Google</External></li>
            </ul>
            <WebsiteField siren={company.siren} website={company.website} canAnalyze={!!company.website} />
            {company.lastCrawledAt && <p className="mt-1 text-xs text-muted-foreground">Dernière analyse : {formatDate(company.lastCrawledAt)}</p>}
          </Section>

          <Section title="Stack détectée">
            {techGroups.length === 0 ? (
              <p className="text-muted-foreground">Rien de détecté pour l'instant. Renseigner le site web puis « Analyser le site ».</p>
            ) : (
              <div className="space-y-3">
                {techGroups.map((g) => (
                  <div key={g.category}>
                    <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{CATEGORY_LABELS[g.category]}</p>
                    <div className="flex flex-wrap gap-1">
                      {g.techs.map((t) => (
                        <span key={t.slug} className="inline-flex items-center gap-1">
                          <TechBadge
                            label={t.label}
                            highlighted={t.inProfile}
                            confidence={Math.max(...t.sources.map((s) => s.confidence))}
                            title={t.sources.map((s) => `${SOURCE_LABELS[s.source] ?? s.source} (${Math.round(s.confidence * 100)} %) : ${s.evidence ?? ''}`).join('\n')}
                          />
                          <span className="text-[10px] text-muted-foreground">{t.sources.map((s) => SOURCE_LABELS[s.source] ?? s.source).join(', ')}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title={`Offres actives (${activeOffers.length})`}>
            {activeOffers.length === 0 ? (
              <p className="text-muted-foreground">Aucune offre active connue. Candidature spontanée potentiellement pertinente.</p>
            ) : (
              <ul className="space-y-1">
                {activeOffers.map((o) => (
                  <li key={o.id}>
                    {o.url ? <External href={o.url}>{o.title}</External> : o.title}
                    <span className="text-muted-foreground"> · {o.contractType ?? '—'} · {formatDate(o.publishedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Signaux">
            {signals.length === 0 && financeYears.length === 0 ? (
              <p className="text-muted-foreground">Aucun signal.</p>
            ) : (
              <>
                <ul className="space-y-1">
                  {signals.map((s) => (
                    <li key={`${s.kind}-${s.detectedAt}`} className="flex justify-between gap-4">
                      <span>{SIGNAL_LABELS[s.kind] ?? s.kind}{s.evidence ? <span className="text-muted-foreground"> — {s.evidence}</span> : null}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatDate(s.detectedAt)}</span>
                    </li>
                  ))}
                </ul>
                {financeYears.length > 0 && (
                  <table className="mt-3 text-xs">
                    <thead><tr><th className="pr-4 text-left font-medium">Année</th><th className="pr-4 text-left font-medium">CA</th><th className="text-left font-medium">Résultat net</th></tr></thead>
                    <tbody>
                      {financeYears.map(([year, f]) => (
                        <tr key={year}><td className="pr-4">{year}</td><td className="pr-4 tabular-nums">{formatEuros(f.ca)}</td><td className="tabular-nums">{formatEuros(f.resultat_net)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Pourquoi cette entreprise">
            <ScoreLines score={score} />
          </Section>
          <Section title="Actions">
            <div className="space-y-3">
              <StatusSelect siren={company.siren} status={status} />
              <NotesField siren={company.siren} notes={notes} />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6 : vérifier**

Run: `pnpm dev`, ouvrir une fiche depuis la liste.
Expected :
- Les sept blocs s'affichent ; les technos du profil sont en badge plein ; le survol d'une techno montre ses sources et preuves.
- Changer le statut, revenir à la liste : le badge de statut apparaît.
- Taper des notes : « Enregistrement… » puis « Enregistré » ; recharger : les notes persistent.
- Sur une entreprise sans site : saisir un domaine, « Enregistrer », puis « Analyser le site » : après quelques secondes, la stack et la page carrière apparaissent (la page se rafraîchit via `revalidatePath`). Sur un site injoignable, le message d'erreur brut s'affiche (`Page d'accueil inaccessible : …`).
- Un SIREN inconnu donne la page 404 de Next.

Run: `pnpm build`
Expected: build sans erreur.

Run: `pnpm lint:fix && pnpm test`

- [ ] **Step 7 : commit**

```bash
git add apps/web
git commit -m "feat(web): fiche entreprise avec stack sourcée, offres, signaux, score expliqué et actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5 : écran Employeurs inconnus

**Files:**
- Create: `apps/web/src/components/link-employer.tsx`, `apps/web/src/app/employeurs-inconnus/page.tsx`
- Create: `apps/web/src/app/api/recherche-entreprises/route.ts`

Le rattachement a besoin d'une recherche de nom au clavier : c'est le seul endroit où un petit Route Handler est plus simple qu'une Server Action (lecture, appelée à chaque frappe).

- [ ] **Step 1 : route de recherche**

`apps/web/src/app/api/recherche-entreprises/route.ts` :

```ts
import { NextResponse } from 'next/server';
import { searchCompaniesByName } from '@/lib/data';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q') ?? '';
  return NextResponse.json(searchCompaniesByName(db(), q));
}
```

- [ ] **Step 2 : composant de rattachement (client)**

`apps/web/src/components/link-employer.tsx` :

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { linkEmployer } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Hit = { siren: string; name: string; city: string | null };

export function LinkEmployer({ employerName }: { employerName: string }) {
  const [q, setQ] = useState(employerName);
  const [hits, setHits] = useState<Hit[]>([]);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!q.trim()) return setHits([]);
      try {
        const res = await fetch(`/api/recherche-entreprises?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        setHits((await res.json()) as Hit[]);
      } catch {
        /* requête annulée */
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  return (
    <div className="mt-2 space-y-2 rounded-md border p-2 text-sm">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher une entreprise de la base" className="h-8" />
      {hits.length > 0 && (
        <ul className="max-h-40 overflow-y-auto">
          {hits.map((h) => (
            <li key={h.siren} className="flex items-center justify-between py-1">
              <span>
                {h.name} <span className="text-muted-foreground">{h.city ?? ''}</span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await linkEmployer(employerName, h.siren);
                    setMessage(r.ok ? (r.message ?? 'Rattaché') : r.error);
                  })
                }
              >
                Rattacher
              </Button>
            </li>
          ))}
        </ul>
      )}
      {message && <p className="text-muted-foreground">{message}</p>}
    </div>
  );
}
```

- [ ] **Step 3 : page**

`apps/web/src/app/employeurs-inconnus/page.tsx` :

```tsx
import { LinkEmployer } from '@/components/link-employer';
import { listUnmatchedOffers } from '@/lib/data';
import { db } from '@/lib/db';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default function UnknownEmployersPage() {
  const groups = listUnmatchedOffers(db());
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Employeurs inconnus</h1>
        <p className="text-sm text-muted-foreground">
          Offres actives dont l'employeur n'a pas été rattaché à une entreprise de la base. Rattacher un employeur mémorise l'alias pour les prochains runs.
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune offre orpheline. Lancer `pnpm pipeline ingest offres` puis `pnpm pipeline match offres` pour en voir.</p>
      ) : (
        <ul className="space-y-4">
          {groups.map((g) => (
            <li key={g.employerName} className="rounded-lg border p-3">
              <div className="flex items-baseline justify-between">
                <h2 className="font-medium">{g.employerName}</h2>
                <span className="text-sm text-muted-foreground">{g.count} offre{g.count > 1 ? 's' : ''}</span>
              </div>
              <ul className="mt-1 text-sm">
                {g.offers.slice(0, 5).map((o) => (
                  <li key={o.id}>
                    {o.url ? (
                      <a href={o.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                        {o.title}
                      </a>
                    ) : (
                      o.title
                    )}
                    <span className="text-muted-foreground"> · {o.city ?? '—'} · {formatDate(o.publishedAt)}</span>
                  </li>
                ))}
              </ul>
              <LinkEmployer employerName={g.employerName} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4 : vérifier**

Run: `pnpm dev`, ouvrir `/employeurs-inconnus`.
Expected: groupes triés par nombre d'offres ; taper dans le champ propose des entreprises ; « Rattacher » affiche « N offres rattachées » et le groupe disparaît au rechargement ; la fiche de l'entreprise montre les offres et leurs technos.

- [ ] **Step 5 : commit**

```bash
git add apps/web
git commit -m "feat(web): écran des employeurs inconnus avec rattachement manuel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6 : écran Profil

**Files:**
- Create: `apps/web/src/components/profile-form.tsx`, `apps/web/src/app/profil/page.tsx`

- [ ] **Step 1 : formulaire (client)**

`apps/web/src/components/profile-form.tsx` :

```tsx
'use client';

import { HEADCOUNT_LABELS } from '@novi/core';
import { useMemo, useState, useTransition } from 'react';
import { geocodeAddress, updateProfile } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Tag = { slug: string; label: string; category: string };
type Initial = { homeLabel: string; homeLatitude: number; homeLongitude: number; radiusKm: number; skills: string[]; headcountRanges: string[] };

const HEADCOUNT_CODES = ['01', '02', '03', '11', '12', '21', '22', '31', '32', '41'];
const CATEGORY_LABELS: Record<string, string> = { language: 'Langages', framework: 'Frameworks', database: 'Bases de données', cloud: 'Cloud', tool: 'Outils', domain: 'Domaines' };

export function ProfileForm({ initial, tags }: { initial: Initial; tags: Tag[] }) {
  const [address, setAddress] = useState(initial.homeLabel);
  const [home, setHome] = useState({ label: initial.homeLabel, latitude: initial.homeLatitude, longitude: initial.homeLongitude });
  const [radius, setRadius] = useState(initial.radiusKm);
  const [skills, setSkills] = useState<string[]>(initial.skills);
  const [ranges, setRanges] = useState<string[]>(initial.headcountRanges);
  const [filter, setFilter] = useState('');
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const grouped = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const map = new Map<string, Tag[]>();
    for (const t of tags) {
      if (f && !t.label.toLowerCase().includes(f) && !skills.includes(t.slug)) continue;
      map.set(t.category, [...(map.get(t.category) ?? []), t]);
    }
    return [...map.entries()];
  }, [tags, filter, skills]);

  const toggle = (list: string[], set: (v: string[]) => void, value: string) => set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await updateProfile({ homeLabel: home.label, homeLatitude: home.latitude, homeLongitude: home.longitude, radiusKm: radius, skills, headcountRanges: ranges });
          setMessage(r.ok ? { kind: 'ok', text: r.message ?? 'Enregistré' } : { kind: 'error', text: r.error });
        });
      }}
    >
      <section className="space-y-2">
        <h2 className="font-medium">Point de départ</h2>
        <div className="flex gap-2">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Adresse ou ville" />
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await geocodeAddress(address);
                if (r.ok) {
                  setHome({ label: r.label, latitude: r.latitude, longitude: r.longitude });
                  setMessage({ kind: 'ok', text: `Localisé : ${r.label}` });
                } else setMessage({ kind: 'error', text: `${r.error}. L'adresse précédente est conservée.` });
              })
            }
          >
            Localiser
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Actuel : {home.label} ({home.latitude.toFixed(4)}, {home.longitude.toFixed(4)})
        </p>
        <label className="flex items-center gap-2 text-sm">
          Rayon
          <Input type="number" min={1} max={200} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-24" />
          km
        </label>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Tailles d'entreprise souhaitées</h2>
        <div className="flex flex-wrap gap-1">
          {HEADCOUNT_CODES.map((code) => (
            <button type="button" key={code} onClick={() => toggle(ranges, setRanges, code)} className={`rounded-full border px-2 py-0.5 text-sm ${ranges.includes(code) ? 'bg-foreground text-background' : ''}`}>
              {HEADCOUNT_LABELS[code]}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Compétences ({skills.length})</h2>
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrer les technos" className="w-64" />
        {grouped.map(([category, list]) => (
          <div key={category}>
            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{CATEGORY_LABELS[category] ?? category}</p>
            <div className="flex flex-wrap gap-1">
              {list.map((t) => (
                <button type="button" key={t.slug} onClick={() => toggle(skills, setSkills, t.slug)} className={`rounded-full border px-2 py-0.5 text-sm ${skills.includes(t.slug) ? 'bg-foreground text-background' : ''}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Enregistrer le profil
        </Button>
        {message && <span className={`text-sm ${message.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{message.text}</span>}
      </div>
    </form>
  );
}
```

- [ ] **Step 2 : page**

`apps/web/src/app/profil/page.tsx` :

```tsx
import { loadTechTags } from '@novi/core';
import { ProfileForm } from '@/components/profile-form';
import { getProfile } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function ProfilePage() {
  const p = getProfile();
  const tags = loadTechTags().map((t) => ({ slug: t.slug, label: t.label, category: t.category }));
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Profil</h1>
      <ProfileForm
        initial={{ homeLabel: p.homeLabel, homeLatitude: p.homeLatitude, homeLongitude: p.homeLongitude, radiusKm: p.radiusKm, skills: p.skills, headcountRanges: p.headcountRanges }}
        tags={tags}
      />
    </div>
  );
}
```

- [ ] **Step 3 : vérifier**

Run: `pnpm dev`, ouvrir `/profil`.
Expected: « Localiser » avec « Antibes » affiche « Localisé : Antibes » et met à jour les coordonnées ; une adresse absurde affiche « Adresse introuvable. L'adresse précédente est conservée. » ; sélectionner React, TypeScript, PostgreSQL puis « Enregistrer le profil » ; retour sur `/` : les scores changent et l'avertissement « Aucune compétence » disparaît.

- [ ] **Step 4 : commit**

```bash
git add apps/web
git commit -m "feat(web): écran profil avec géocodage, rayon, tailles et compétences

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7 : écran Pipeline

**Files:**
- Create: `apps/web/src/app/pipeline/page.tsx`

- [ ] **Step 1 : page**

`apps/web/src/app/pipeline/page.tsx` :

```tsx
import { pipelineOverview } from '@/lib/data';
import { db } from '@/lib/db';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const COUNT_LABELS: Record<string, string> = {
  companies: 'Entreprises',
  withWebsite: 'Avec site web',
  crawled: 'Sites analysés',
  techDetections: 'Technos détectées',
  activeOffers: 'Offres actives',
  unmatchedOffers: 'Offres non rattachées',
};

function duration(start: string, end: string | null): string {
  if (!end) return 'en cours';
  const s = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export default function PipelinePage() {
  const { runs, counts } = pipelineOverview(db());
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Pipeline</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {Object.entries(counts).map(([key, value]) => (
          <div key={key} className="rounded-lg border p-3">
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{COUNT_LABELS[key] ?? key}</p>
          </div>
        ))}
      </div>
      <div>
        <h2 className="mb-2 font-medium">Derniers runs</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun run. Lancer `pnpm pipeline run all --departement 06`.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Commande</th>
                <th className="py-1 pr-3">Début</th>
                <th className="py-1 pr-3">Durée</th>
                <th className="py-1 pr-3">Statistiques</th>
                <th className="py-1">Erreurs</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="py-1 pr-3 font-mono text-xs">{r.command}</td>
                  <td className="py-1 pr-3">{formatDate(r.startedAt)}</td>
                  <td className="py-1 pr-3">{duration(r.startedAt, r.finishedAt)}</td>
                  <td className="py-1 pr-3 font-mono text-xs">{r.stats ? Object.entries(r.stats).map(([k, v]) => `${k}=${v}`).join(' ') : '—'}</td>
                  <td className="py-1 text-xs">
                    {r.errors.length === 0 ? '0' : (
                      <details>
                        <summary className="cursor-pointer">{r.errors.length}</summary>
                        <ul className="mt-1 space-y-0.5 text-muted-foreground">
                          {r.errors.slice(0, 20).map((e, i) => (
                            <li key={`${e.siren ?? ''}-${i}`}>{e.siren ? `${e.siren} : ` : ''}{e.message}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : vérifier et committer**

Run: `pnpm dev`, ouvrir `/pipeline`.
Expected: six compteurs et le tableau des runs, les erreurs dépliables.

```bash
git add apps/web
git commit -m "feat(web): écran pipeline (compteurs et derniers runs)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8 : vérification finale et documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1 : README**

Dans `README.md`, remplacer la ligne `- apps/web : application Next.js (Plan 2).` par :

```markdown
- `apps/web` : application Next.js. `pnpm dev` puis http://localhost:3000.
  - `/` exploration : liste et carte, filtres dans l'URL.
  - `/entreprises/<siren>` fiche : identité, présence en ligne (avec « Analyser le site »), stack sourcée, offres, signaux, score expliqué, statut et notes.
  - `/employeurs-inconnus` : offres non rattachées, rattachement manuel mémorisé.
  - `/profil` : adresse géocodée, rayon, tailles, compétences.
  - `/pipeline` : compteurs et derniers runs.
```

Et dans la section « Mise en route », ajouter après la ligne du pipeline : `pnpm dev`.

- [ ] **Step 2 : vérification complète**

Run: `pnpm lint:fix && pnpm typecheck && pnpm test && pnpm build`
Expected: tout vert. `pnpm typecheck` dans `apps/web` peut nécessiter un `next-env.d.ts` généré par le premier `pnpm dev` ou `pnpm build` : lancer `pnpm build` avant si besoin.

Parcours manuel complet avec la base réelle :
1. `/profil` : localiser Nice, rayon 30, choisir tes technos, enregistrer.
2. `/` : les entreprises les mieux scorées en haut, filtrer sur une techno, « Recrute actuellement ».
3. Ouvrir une fiche, passer en « Intéressée », écrire une note, renseigner un site manquant, analyser.
4. `/employeurs-inconnus` : rattacher un employeur, vérifier sa fiche.
5. `/pipeline` : compteurs cohérents avec la base.

- [ ] **Step 3 : commit**

```bash
git add -A
git commit -m "docs: README pour l'app web

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Couverture du spec (section 7 et 8)

| Exigence | Tâche |
|---|---|
| 7.1 Exploration : liste, carte, filtres URL, survol, clic marqueur, état vide | 3 |
| 7.2 Fiche : sept blocs, statut, notes auto, site manuel, « Analyser le site » avec délai 60 s | 4 |
| 7.3 Employeurs inconnus : groupes, recherche, rattachement, alias, technos | 5 (données en 2, mutation en 4) |
| 7.4 Profil : géocodage API Adresse, rayon, compétences, tailles | 6 |
| 7.5 Pipeline : runs et compteurs | 7 |
| 8 Erreurs web : états vides, erreurs d'action affichées, crawl borné, géocodage conservant l'adresse | 3, 4, 6 |
| 9 Tests web : fonctions de requête et de mutation, sans rendu | 2, 4 |
