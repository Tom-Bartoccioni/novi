# Novi V1 — Plan 1 : couche données (monorepo, core, db, pipeline)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un monorepo pnpm avec une ligne de commande `pnpm pipeline` qui ingère les entreprises tech des Alpes-Maritimes, les offres France Travail, découvre et analyse leurs sites web, et remplit une base SQLite prête pour l'app web du Plan 2.

**Architecture:** Trois paquets TypeScript consommés en source (pas d'étape de build) : `@novi/core` (fonctions pures : normalisation, détection de technos, scoring, config), `@novi/db` (schéma Drizzle, client SQLite, migrations, module géographique isolé), `@novi/pipeline` (commandes commander, une par étape, chacune journalisée dans `crawl_runs`). Les tests Vitest ne touchent jamais le réseau : les réponses d'API sont des fixtures JSON.

**Tech Stack:** Node 22+, pnpm 9, TypeScript 5.9, Drizzle ORM 0.45 + better-sqlite3 13, Zod 4, Vitest 5, Biome 2, commander 15, cheerio 1.2, robots-parser 3, p-limit 7, tsx.

**Spec de référence :** `docs/superpowers/specs/2026-09-29-novi-v1-design.md`. Le plan suit ses sections 2 à 6 et 8 à 10. Le Plan 2 couvre la section 7 (app web).

**Conventions :**
- Prose et messages de commit en français, identifiants de code en anglais.
- Toutes les commandes se lancent depuis la racine du dépôt `C:\Users\tomba\Downloads\Novi` (PowerShell ou Git Bash).
- Chaque tâche finit par un commit. Auteur git : `git -c user.name=tomba -c user.email=contact@simwego.com commit ...` si l'identité globale n'est pas configurée ; le plan écrit simplement `git commit`.
- Terminer chaque message de commit par la ligne `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## Structure des fichiers

```
package.json                       scripts racine (test, lint, db:migrate, pipeline, dev)
pnpm-workspace.yaml
tsconfig.base.json                 options TS partagées (ESNext, bundler, strict, resolveJsonModule)
biome.json
vitest.config.ts                   projets vitest = packages/*
.env.example
README.md

packages/core/
  package.json                     "@novi/core", exports ./src/index.ts
  tsconfig.json
  config/ingest.json               codes NAF, tranches, codes ROME, libellés
  config/tech-tags.json            dictionnaire des technos
  config/esn-keywords.json
  config/crawl-paths.json
  src/index.ts                     ré-exporte tout
  src/normalize.ts                 normalizeCompanyName, slugify, significantWords, LEGAL_FORMS
  src/similarity.ts                trigramSimilarity
  src/geo.ts                       distanceKm (haversine)
  src/config.ts                    schémas Zod + loaders des 4 JSON, HEADCOUNT_LABELS
  src/detect.ts                    detectTechs, detectFingerprints, mergeDetections, detectEsn, splitSentences
  src/score.ts                     scoreCompany
  src/types.ts                     types partagés (Detection, ScoreProfile, ScoreCompany, ScoreResult)
  test/*.test.ts

packages/db/
  package.json                     "@novi/db"
  drizzle.config.ts
  drizzle/                         migrations SQL générées par drizzle-kit
  src/index.ts
  src/schema.ts                    les 9 tables
  src/client.ts                    createDb, getDb, findRepoRoot, DEFAULT_DB_PATH
  src/migrate.ts                   runMigrations + seed (tech_tags, profil par défaut) ; exécutable via tsx
  src/geo.ts                       companiesWithinRadius (seule fonction à réécrire pour PostGIS)
  src/queries.ts                   helpers d'écriture partagés (upsertCompanyTech, replaceSignals…)
  test/*.test.ts

packages/pipeline/
  package.json                     "@novi/pipeline"
  src/cli.ts                       commander : ingest sirene|offres, match offres, discover websites, crawl websites, enrich github, signals, run all
  src/lib/env.ts                   lecture .env
  src/lib/http.ts                  fetchWithTimeout, fetchJson, fetchText, USER_AGENT
  src/lib/rate-limit.ts            createLimiter(perSecond)
  src/lib/run.ts                   withRun (journal crawl_runs), RunStats
  src/lib/logger.ts                log, warn
  src/sources/recherche-entreprises.ts
  src/sources/france-travail.ts
  src/sources/overpass.ts
  src/sources/github.ts
  src/sources/adresse.ts           géocodage (utilisé par le Plan 2)
  src/steps/ingest-sirene.ts
  src/steps/ingest-offres.ts
  src/steps/match-offres.ts
  src/steps/discover-websites.ts
  src/steps/crawl-websites.ts      exporte aussi crawlCompany(siren) pour l'app
  src/steps/enrich-github.ts
  src/steps/signals.ts
  src/index.ts                     exporte les steps et sources pour l'app
  test/fixtures/*.json|*.html
  test/*.test.ts
```

---

### Task 1 : Monorepo pnpm, outillage, premier test

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `vitest.config.ts`, `.env.example`, `README.md`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/test/smoke.test.ts`

- [ ] **Step 1 : fichiers racine**

`package.json` :

```json
{
  "name": "novi",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "packageManager": "pnpm@9.15.9",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "typecheck": "pnpm -r exec tsc --noEmit",
    "db:generate": "pnpm --filter @novi/db generate",
    "db:migrate": "pnpm --filter @novi/db migrate",
    "pipeline": "pnpm --filter @novi/pipeline exec tsx src/cli.ts"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.5.14",
    "@types/node": "^26.6.3",
    "tsx": "^4.23.15",
    "typescript": "^5.9.3",
    "vitest": "^5.0.2"
  }
}
```

`pnpm-workspace.yaml` :

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`tsconfig.base.json` :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["node"]
  }
}
```

`biome.json` :

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.14/schema.json",
  "files": { "includes": ["**", "!**/node_modules", "!**/.next", "!**/drizzle/meta", "!**/data"] },
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 110 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "always" } }
}
```

`vitest.config.ts` :

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
    passWithNoTests: true,
  },
});
```

`.env.example` :

```
FRANCE_TRAVAIL_CLIENT_ID=
FRANCE_TRAVAIL_CLIENT_SECRET=
GITHUB_TOKEN=
DATABASE_URL=file:./data/novi.db
```

`README.md` (sera complété en Task 18) :

```markdown
# Novi

Découverte de startups et PME tech autour de chez soi. Voir `Concept.md` et `docs/superpowers/specs/`.

## Prérequis

Node 22+, pnpm 9. Copier `.env.example` en `.env`.
```

- [ ] **Step 2 : paquet core minimal**

`packages/core/package.json` :

```json
{
  "name": "@novi/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run" },
  "dependencies": { "zod": "^4.6.5" },
  "devDependencies": { "typescript": "^5.9.3", "vitest": "^5.0.2" }
}
```

`packages/core/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test", "config"]
}
```

`packages/core/src/index.ts` :

```ts
export const CORE_VERSION = '0.0.0';
```

`packages/core/test/smoke.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from '../src/index';

describe('core', () => {
  it('exports a version', () => {
    expect(CORE_VERSION).toBe('0.0.0');
  });
});
```

- [ ] **Step 3 : installer et vérifier**

Run: `pnpm install`
Expected: installation sans erreur, `node_modules/` créé, `pnpm-lock.yaml` créé.

Run: `pnpm test`
Expected: `✓ packages/core/test/smoke.test.ts (1 test)`, `Test Files 1 passed`.

Run: `pnpm lint`
Expected: `Checked N files ... No fixes applied` (aucune erreur). Si Biome signale du formatage, lancer `pnpm lint:fix`.

- [ ] **Step 4 : commit**

```bash
git add -A
git commit -m "chore: monorepo pnpm, biome, vitest, paquet core minimal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2 : core — normalisation des noms et similarité

**Files:**
- Create: `packages/core/src/normalize.ts`, `packages/core/src/similarity.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/normalize.test.ts`, `packages/core/test/similarity.test.ts`

- [ ] **Step 1 : tests de normalisation**

`packages/core/test/normalize.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { normalizeCompanyName, significantWords, slugify } from '../src/normalize';

describe('normalizeCompanyName', () => {
  it('lowercases, strips accents and punctuation', () => {
    expect(normalizeCompanyName('Société Générale-Informatique !')).toBe('societe generale informatique');
  });
  it('removes legal forms wherever they appear', () => {
    expect(normalizeCompanyName('SAS CLIKEN WEB')).toBe('cliken web');
    expect(normalizeCompanyName('Cliken Web SAS')).toBe('cliken web');
    expect(normalizeCompanyName('S.A.R.L. Dupont')).toBe('dupont');
    expect(normalizeCompanyName('WeTech SASU')).toBe('wetech');
  });
  it('collapses whitespace', () => {
    expect(normalizeCompanyName('  Tech   Nice  ')).toBe('tech nice');
  });
  it('keeps digits', () => {
    expect(normalizeCompanyName('Studio 42')).toBe('studio 42');
  });
});

describe('slugify', () => {
  it('produces a domain-safe slug', () => {
    expect(slugify('Cliken Web')).toBe('clikenweb');
    expect(slugify('Émile & Co')).toBe('emileco');
  });
});

describe('significantWords', () => {
  it('drops stop words and short words', () => {
    expect(significantWords('Les Ateliers du Code')).toEqual(['ateliers', 'code']);
    expect(significantWords('WEB PRO')).toEqual([]);
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `pnpm vitest run packages/core/test/normalize.test.ts`
Expected: FAIL, `Cannot find module '../src/normalize'`.

- [ ] **Step 3 : implémentation**

`packages/core/src/normalize.ts` :

```ts
export const LEGAL_FORMS = [
  'sasu', 'sas', 'sarl', 'eurl', 'scop', 'sa', 'snc', 'sci', 'selarl', 'societe par actions simplifiee',
  'societe a responsabilite limitee', 'entreprise unipersonnelle a responsabilite limitee',
];

const STOP_WORDS = new Set([
  'les', 'des', 'the', 'and', 'pour', 'avec', 'sur', 'sous', 'dans', 'par', 'une', 'group', 'groupe',
  'company', 'compagnie', 'societe', 'entreprise', 'france', 'web', 'pro', 'tech', 'digital', 'solutions',
  'services', 'consulting', 'conseil', 'studio', 'agency', 'agence',
]);

export function stripAccents(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function basicClean(input: string): string {
  return stripAccents(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeCompanyName(name: string): string {
  // "S.A.R.L." -> "sarl" before punctuation is turned into spaces
  const dotted = name.replace(/\b([a-zA-Z])\.(?=[a-zA-Z]\.)/g, '$1').replace(/\b([a-zA-Z]{2,5})\./g, '$1 ');
  const cleaned = basicClean(dotted);
  const words = cleaned.split(' ').filter((w) => w.length > 0 && !LEGAL_FORMS.includes(w));
  let result = words.join(' ');
  for (const form of LEGAL_FORMS.filter((f) => f.includes(' '))) {
    result = result.replace(form, ' ');
  }
  return result.trim().replace(/\s+/g, ' ');
}

export function slugify(name: string): string {
  return normalizeCompanyName(name).replace(/\s+/g, '');
}

export function significantWords(name: string): string[] {
  return normalizeCompanyName(name)
    .split(' ')
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
}
```

- [ ] **Step 4 : test de similarité**

`packages/core/test/similarity.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { trigramSimilarity } from '../src/similarity';

describe('trigramSimilarity', () => {
  it('is 1 for identical strings and 0 for disjoint ones', () => {
    expect(trigramSimilarity('cliken web', 'cliken web')).toBe(1);
    expect(trigramSimilarity('abc', 'xyz')).toBe(0);
  });
  it('is high for a one-letter typo', () => {
    expect(trigramSimilarity('cliken web', 'clicken web')).toBeGreaterThan(0.6);
  });
  it('is low for different names', () => {
    expect(trigramSimilarity('cliken web', 'nice tech studio')).toBeLessThan(0.2);
  });
  it('handles empty strings', () => {
    expect(trigramSimilarity('', 'abc')).toBe(0);
  });
});
```

- [ ] **Step 5 : implémentation**

`packages/core/src/similarity.ts` :

```ts
function trigrams(input: string): Set<string> {
  const padded = `  ${input} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Coefficient de Dice sur trigrammes, entre 0 et 1. */
export function trigramSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return (2 * common) / (ta.size + tb.size);
}
```

- [ ] **Step 6 : exports et vérification**

`packages/core/src/index.ts` :

```ts
export const CORE_VERSION = '0.0.0';
export * from './normalize';
export * from './similarity';
```

Run: `pnpm vitest run packages/core`
Expected: tous les tests passent (normalize 5, similarity 4, smoke 1). Si `'S.A.R.L. Dupont'` échoue, vérifier la regex des points : l'entrée doit devenir `sarl dupont` avant filtrage.

- [ ] **Step 7 : commit**

```bash
git add packages/core
git commit -m "feat(core): normalisation des noms d'entreprise et similarité trigrammes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3 : core — distance haversine

**Files:**
- Create: `packages/core/src/geo.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/geo.test.ts`

- [ ] **Step 1 : test**

`packages/core/test/geo.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { distanceKm } from '../src/geo';

const NICE = { latitude: 43.7102, longitude: 7.262 };
const SOPHIA = { latitude: 43.6161, longitude: 7.0553 };
const CANNES = { latitude: 43.5528, longitude: 7.0174 };

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm(NICE, NICE)).toBe(0);
  });
  it('Nice to Sophia Antipolis is about 20 km', () => {
    expect(distanceKm(NICE, SOPHIA)).toBeGreaterThan(18);
    expect(distanceKm(NICE, SOPHIA)).toBeLessThan(21);
  });
  it('Nice to Cannes is about 26 km', () => {
    expect(distanceKm(NICE, CANNES)).toBeGreaterThan(25);
    expect(distanceKm(NICE, CANNES)).toBeLessThan(28);
  });
});
```

- [ ] **Step 2 : implémentation**

`packages/core/src/geo.ts` :

```ts
export type Point = { latitude: number; longitude: number };

const EARTH_RADIUS_KM = 6371;

export function distanceKm(a: Point, b: Point): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}
```

Ajouter `export * from './geo';` dans `packages/core/src/index.ts`.

- [ ] **Step 3 : vérifier et committer**

Run: `pnpm vitest run packages/core/test/geo.test.ts`
Expected: 3 tests passent.

```bash
git add packages/core
git commit -m "feat(core): distance haversine

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4 : core — fichiers de configuration et loaders validés par Zod

**Files:**
- Create: `packages/core/config/ingest.json`, `packages/core/config/tech-tags.json`, `packages/core/config/esn-keywords.json`, `packages/core/config/crawl-paths.json`
- Create: `packages/core/src/config.ts`, `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/config.test.ts`

- [ ] **Step 1 : test des loaders**

`packages/core/test/config.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import {
  HEADCOUNT_LABELS,
  loadCrawlPaths,
  loadEsnKeywords,
  loadIngestConfig,
  loadTechTags,
} from '../src/config';

describe('config loaders', () => {
  it('ingest config has NAF codes, headcount ranges and ROME codes', () => {
    const cfg = loadIngestConfig();
    expect(cfg.nafCodes).toContain('62.01Z');
    expect(cfg.nafLabels['62.01Z']).toBe('Programmation informatique');
    expect(cfg.headcountRanges).toEqual(['03', '11', '12', '21', '22']);
    expect(cfg.romeCodes).toContain('M1805');
  });
  it('tech tags are unique by slug and every alias is lowercase', () => {
    const tags = loadTechTags();
    expect(tags.length).toBeGreaterThan(100);
    const slugs = new Set(tags.map((t) => t.slug));
    expect(slugs.size).toBe(tags.length);
    for (const t of tags) for (const a of t.aliases) expect(a).toBe(a.toLowerCase());
  });
  it('ambiguous tags require context', () => {
    const go = loadTechTags().find((t) => t.slug === 'go');
    expect(go?.contextRequired?.length).toBeGreaterThan(0);
  });
  it('esn keywords and crawl paths load', () => {
    expect(loadEsnKeywords()).toContain('portage salarial');
    expect(loadCrawlPaths()).toContain('/carrieres');
  });
  it('headcount labels cover INSEE codes', () => {
    expect(HEADCOUNT_LABELS['12']).toBe('20 à 49 salariés');
    expect(HEADCOUNT_LABELS.NN).toBe('Non renseigné');
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `pnpm vitest run packages/core/test/config.test.ts`
Expected: FAIL, module `../src/config` introuvable.

- [ ] **Step 3 : `ingest.json`**

`packages/core/config/ingest.json` :

```json
{
  "nafCodes": [
    "62.01Z", "62.02A", "62.02B", "62.03Z", "62.09Z", "63.11Z", "63.12Z",
    "58.21Z", "58.29A", "58.29B", "58.29C", "72.19Z", "71.12B"
  ],
  "nafLabels": {
    "62.01Z": "Programmation informatique",
    "62.02A": "Conseil en systèmes et logiciels informatiques",
    "62.02B": "Tierce maintenance de systèmes et d'applications informatiques",
    "62.03Z": "Gestion d'installations informatiques",
    "62.09Z": "Autres activités informatiques",
    "63.11Z": "Traitement de données, hébergement et activités connexes",
    "63.12Z": "Portails Internet",
    "58.21Z": "Édition de jeux électroniques",
    "58.29A": "Édition de logiciels système et de réseau",
    "58.29B": "Édition de logiciels outils de développement et de langages",
    "58.29C": "Édition de logiciels applicatifs",
    "72.19Z": "Recherche-développement en autres sciences physiques et naturelles",
    "71.12B": "Ingénierie, études techniques"
  },
  "headcountRanges": ["03", "11", "12", "21", "22"],
  "romeCodes": ["M1805", "M1810", "M1802", "M1806", "M1803"],
  "romeLabels": {
    "M1805": "Études et développement informatique",
    "M1810": "Production et exploitation de systèmes d'information",
    "M1802": "Expertise et support en systèmes d'information",
    "M1806": "Conseil et maîtrise d'ouvrage en systèmes d'information",
    "M1803": "Direction des systèmes d'information"
  }
}
```

- [ ] **Step 4 : `tech-tags.json`**

Chaque entrée : `slug`, `label`, `category` (`language | framework | database | cloud | tool | domain`), `aliases` (minuscules), facultatifs `contextRequired` (motifs minuscules devant apparaître dans la même phrase) et `fingerprints` (sous-chaînes cherchées dans le HTML brut ou les en-têtes HTTP, minuscules).

`packages/core/config/tech-tags.json` :

```json
[
  { "slug": "typescript", "label": "TypeScript", "category": "language", "aliases": ["typescript", "ts"], "contextRequired": ["typescript", "javascript", "node", "react", "angular", "vue", "front"] },
  { "slug": "javascript", "label": "JavaScript", "category": "language", "aliases": ["javascript", "js", "ecmascript"], "contextRequired": ["javascript", "front", "web", "node", "react", "vue", "angular", "développeur", "developer", "développeuse"] },
  { "slug": "python", "label": "Python", "category": "language", "aliases": ["python"] },
  { "slug": "java", "label": "Java", "category": "language", "aliases": ["java"] },
  { "slug": "kotlin", "label": "Kotlin", "category": "language", "aliases": ["kotlin"] },
  { "slug": "scala", "label": "Scala", "category": "language", "aliases": ["scala"] },
  { "slug": "csharp", "label": "C#", "category": "language", "aliases": ["c#", "csharp", "c sharp"] },
  { "slug": "dotnet", "label": ".NET", "category": "framework", "aliases": [".net", "dotnet", "asp.net", "aspnet"], "fingerprints": ["x-powered-by: asp.net", "__viewstate", "x-aspnet-version"] },
  { "slug": "cpp", "label": "C++", "category": "language", "aliases": ["c++", "cpp"] },
  { "slug": "c", "label": "C", "category": "language", "aliases": ["c"], "contextRequired": ["langage c", "c language", "c/c++", "c embarqué", "embedded c", "ansi c", "développeur c", "c developer"] },
  { "slug": "go", "label": "Go", "category": "language", "aliases": ["golang", "go"], "contextRequired": ["golang", "langage go", "go language", "développeur go", "go developer", "en go", "in go", "go/", "/go"] },
  { "slug": "rust", "label": "Rust", "category": "language", "aliases": ["rust"], "contextRequired": ["rust", "cargo", "wasm", "développeur", "developer", "langage", "language", "backend", "systems"] },
  { "slug": "php", "label": "PHP", "category": "language", "aliases": ["php"], "fingerprints": ["x-powered-by: php", "phpsessid"] },
  { "slug": "ruby", "label": "Ruby", "category": "language", "aliases": ["ruby"] },
  { "slug": "rails", "label": "Ruby on Rails", "category": "framework", "aliases": ["ruby on rails", "rails", "ror"], "fingerprints": ["csrf-param", "x-powered-by: phusion passenger"] },
  { "slug": "swift", "label": "Swift", "category": "language", "aliases": ["swift"], "contextRequired": ["ios", "apple", "swiftui", "xcode", "macos", "développeur", "developer", "mobile"] },
  { "slug": "objective-c", "label": "Objective-C", "category": "language", "aliases": ["objective-c", "objective c", "objc"] },
  { "slug": "dart", "label": "Dart", "category": "language", "aliases": ["dart"], "contextRequired": ["flutter", "dart language", "langage dart", "mobile"] },
  { "slug": "flutter", "label": "Flutter", "category": "framework", "aliases": ["flutter"] },
  { "slug": "elixir", "label": "Elixir", "category": "language", "aliases": ["elixir"] },
  { "slug": "phoenix", "label": "Phoenix", "category": "framework", "aliases": ["phoenix framework", "phoenix liveview", "liveview"], "fingerprints": ["phx-", "phoenix_html"] },
  { "slug": "erlang", "label": "Erlang", "category": "language", "aliases": ["erlang"] },
  { "slug": "haskell", "label": "Haskell", "category": "language", "aliases": ["haskell"] },
  { "slug": "ocaml", "label": "OCaml", "category": "language", "aliases": ["ocaml"] },
  { "slug": "clojure", "label": "Clojure", "category": "language", "aliases": ["clojure", "clojurescript"] },
  { "slug": "r", "label": "R", "category": "language", "aliases": ["r"], "contextRequired": ["langage r", "r language", "r studio", "rstudio", "tidyverse", "shiny", "statisti"] },
  { "slug": "julia", "label": "Julia", "category": "language", "aliases": ["julia"], "contextRequired": ["julia language", "langage julia", "julialang", "scientifique", "scientific", "numerical"] },
  { "slug": "matlab", "label": "MATLAB", "category": "language", "aliases": ["matlab", "simulink"] },
  { "slug": "sql", "label": "SQL", "category": "language", "aliases": ["sql"] },
  { "slug": "bash", "label": "Shell", "category": "language", "aliases": ["bash", "shell script", "scripting shell"] },
  { "slug": "zig", "label": "Zig", "category": "language", "aliases": ["zig"], "contextRequired": ["ziglang", "zig language", "langage zig", "systems", "développeur", "developer"] },
  { "slug": "webassembly", "label": "WebAssembly", "category": "tool", "aliases": ["webassembly", "wasm"] },
  { "slug": "react", "label": "React", "category": "framework", "aliases": ["react", "reactjs", "react.js"], "fingerprints": ["data-reactroot", "react-dom", "__react", "data-reactid"] },
  { "slug": "nextjs", "label": "Next.js", "category": "framework", "aliases": ["next.js", "nextjs", "next js"], "fingerprints": ["__next", "_next/static", "x-powered-by: next.js"] },
  { "slug": "remix", "label": "Remix", "category": "framework", "aliases": ["remix"], "contextRequired": ["remix run", "remix.run", "react", "framework", "remix js"], "fingerprints": ["__remixcontext", "__remixmanifest"] },
  { "slug": "vue", "label": "Vue.js", "category": "framework", "aliases": ["vue", "vue.js", "vuejs"], "fingerprints": ["data-v-app", "__vue__", "data-v-"] },
  { "slug": "nuxt", "label": "Nuxt", "category": "framework", "aliases": ["nuxt", "nuxt.js", "nuxtjs"], "fingerprints": ["_nuxt/", "__nuxt", "data-nuxt"] },
  { "slug": "angular", "label": "Angular", "category": "framework", "aliases": ["angular", "angularjs"], "fingerprints": ["ng-version", "ng-app", "app-root"] },
  { "slug": "svelte", "label": "Svelte", "category": "framework", "aliases": ["svelte", "sveltekit", "svelte kit"], "fingerprints": ["data-sveltekit", "svelte-", "__sveltekit"] },
  { "slug": "solid", "label": "SolidJS", "category": "framework", "aliases": ["solidjs", "solid.js", "solid js"] },
  { "slug": "astro", "label": "Astro", "category": "framework", "aliases": ["astro"], "contextRequired": ["astro.build", "astro framework", "static site", "site statique", "front", "web"], "fingerprints": ["astro-island", "generator\" content=\"astro"] },
  { "slug": "qwik", "label": "Qwik", "category": "framework", "aliases": ["qwik"], "fingerprints": ["q:container"] },
  { "slug": "htmx", "label": "htmx", "category": "framework", "aliases": ["htmx"], "fingerprints": ["hx-get", "hx-post", "htmx.org"] },
  { "slug": "alpinejs", "label": "Alpine.js", "category": "framework", "aliases": ["alpine.js", "alpinejs"], "fingerprints": ["x-data=", "alpinejs"] },
  { "slug": "jquery", "label": "jQuery", "category": "framework", "aliases": ["jquery"], "fingerprints": ["jquery.min.js", "jquery-"] },
  { "slug": "tailwind", "label": "Tailwind CSS", "category": "tool", "aliases": ["tailwind", "tailwindcss", "tailwind css"], "fingerprints": ["tailwindcss", "--tw-"] },
  { "slug": "bootstrap", "label": "Bootstrap", "category": "tool", "aliases": ["bootstrap"], "contextRequired": ["css", "bootstrap 4", "bootstrap 5", "front", "web"], "fingerprints": ["bootstrap.min.css", "bootstrap.min.js"] },
  { "slug": "vite", "label": "Vite", "category": "tool", "aliases": ["vite", "vitejs"], "fingerprints": ["/@vite/", "vite/modulepreload"] },
  { "slug": "webpack", "label": "webpack", "category": "tool", "aliases": ["webpack"], "fingerprints": ["webpackjsonp", "webpack_require"] },
  { "slug": "storybook", "label": "Storybook", "category": "tool", "aliases": ["storybook"] },
  { "slug": "threejs", "label": "Three.js", "category": "framework", "aliases": ["three.js", "threejs", "webgl"], "fingerprints": ["three.module.js", "three.min.js"] },
  { "slug": "nodejs", "label": "Node.js", "category": "framework", "aliases": ["node.js", "nodejs", "node js", "node"], "contextRequired": ["node.js", "nodejs", "node js", "javascript", "typescript", "backend", "express", "npm"], "fingerprints": ["x-powered-by: express"] },
  { "slug": "express", "label": "Express", "category": "framework", "aliases": ["express.js", "expressjs", "express"], "contextRequired": ["node", "express.js", "expressjs", "javascript", "api", "backend"] },
  { "slug": "nestjs", "label": "NestJS", "category": "framework", "aliases": ["nestjs", "nest.js", "nest js"] },
  { "slug": "fastify", "label": "Fastify", "category": "framework", "aliases": ["fastify"] },
  { "slug": "hono", "label": "Hono", "category": "framework", "aliases": ["hono"], "contextRequired": ["hono.dev", "honojs", "typescript", "edge", "cloudflare", "framework"] },
  { "slug": "bun", "label": "Bun", "category": "tool", "aliases": ["bun"], "contextRequired": ["bun.sh", "bunjs", "runtime", "javascript", "typescript", "node"] },
  { "slug": "deno", "label": "Deno", "category": "tool", "aliases": ["deno"] },
  { "slug": "graphql", "label": "GraphQL", "category": "tool", "aliases": ["graphql", "apollo"], "fingerprints": ["/graphql"] },
  { "slug": "trpc", "label": "tRPC", "category": "framework", "aliases": ["trpc"] },
  { "slug": "django", "label": "Django", "category": "framework", "aliases": ["django"], "fingerprints": ["csrfmiddlewaretoken", "csrftoken"] },
  { "slug": "flask", "label": "Flask", "category": "framework", "aliases": ["flask"] },
  { "slug": "fastapi", "label": "FastAPI", "category": "framework", "aliases": ["fastapi", "fast api"] },
  { "slug": "spring", "label": "Spring", "category": "framework", "aliases": ["spring boot", "spring", "springboot"], "contextRequired": ["java", "spring boot", "springboot", "spring framework", "backend", "kotlin"], "fingerprints": ["jsessionid"] },
  { "slug": "quarkus", "label": "Quarkus", "category": "framework", "aliases": ["quarkus"] },
  { "slug": "symfony", "label": "Symfony", "category": "framework", "aliases": ["symfony"], "fingerprints": ["x-debug-token", "_symfony"] },
  { "slug": "laravel", "label": "Laravel", "category": "framework", "aliases": ["laravel"], "fingerprints": ["laravel_session", "x-powered-by: laravel"] },
  { "slug": "wordpress", "label": "WordPress", "category": "tool", "aliases": ["wordpress", "woocommerce"], "fingerprints": ["wp-content", "wp-includes", "generator\" content=\"wordpress"] },
  { "slug": "drupal", "label": "Drupal", "category": "tool", "aliases": ["drupal"], "fingerprints": ["x-generator: drupal", "drupal-settings-json", "/sites/default/files"] },
  { "slug": "prestashop", "label": "PrestaShop", "category": "tool", "aliases": ["prestashop"], "fingerprints": ["prestashop", "/modules/ps_"] },
  { "slug": "magento", "label": "Magento", "category": "tool", "aliases": ["magento", "adobe commerce"], "fingerprints": ["mage/cookies", "magento"] },
  { "slug": "shopify", "label": "Shopify", "category": "tool", "aliases": ["shopify"], "fingerprints": ["cdn.shopify.com", "shopify.theme"] },
  { "slug": "webflow", "label": "Webflow", "category": "tool", "aliases": ["webflow"], "fingerprints": ["generator\" content=\"webflow", "webflow.js", "w-nav"] },
  { "slug": "wix", "label": "Wix", "category": "tool", "aliases": ["wix"], "contextRequired": ["wix.com", "site wix", "wix site"], "fingerprints": ["x-wix-request-id", "static.wixstatic.com", "generator\" content=\"wix"] },
  { "slug": "postgresql", "label": "PostgreSQL", "category": "database", "aliases": ["postgresql", "postgres", "postgre", "pgsql"] },
  { "slug": "mysql", "label": "MySQL", "category": "database", "aliases": ["mysql", "mariadb"] },
  { "slug": "sqlite", "label": "SQLite", "category": "database", "aliases": ["sqlite"] },
  { "slug": "mongodb", "label": "MongoDB", "category": "database", "aliases": ["mongodb", "mongo"] },
  { "slug": "redis", "label": "Redis", "category": "database", "aliases": ["redis", "valkey"] },
  { "slug": "elasticsearch", "label": "Elasticsearch", "category": "database", "aliases": ["elasticsearch", "elastic search", "opensearch", "elastic stack", "elk"] },
  { "slug": "cassandra", "label": "Cassandra", "category": "database", "aliases": ["cassandra", "scylladb"] },
  { "slug": "neo4j", "label": "Neo4j", "category": "database", "aliases": ["neo4j", "graph database", "base de données graphe"] },
  { "slug": "clickhouse", "label": "ClickHouse", "category": "database", "aliases": ["clickhouse"] },
  { "slug": "supabase", "label": "Supabase", "category": "database", "aliases": ["supabase"], "fingerprints": ["supabase.co"] },
  { "slug": "firebase", "label": "Firebase", "category": "database", "aliases": ["firebase", "firestore"], "fingerprints": ["firebaseapp.com", "firebase-app.js"] },
  { "slug": "prisma", "label": "Prisma", "category": "tool", "aliases": ["prisma"] },
  { "slug": "drizzle", "label": "Drizzle", "category": "tool", "aliases": ["drizzle", "drizzle orm"] },
  { "slug": "kafka", "label": "Kafka", "category": "tool", "aliases": ["kafka", "apache kafka"] },
  { "slug": "rabbitmq", "label": "RabbitMQ", "category": "tool", "aliases": ["rabbitmq", "amqp"] },
  { "slug": "aws", "label": "AWS", "category": "cloud", "aliases": ["aws", "amazon web services", "ec2", "lambda", "s3"], "contextRequired": ["aws", "amazon", "cloud", "ec2", "serverless"], "fingerprints": ["amazonaws.com", "cloudfront.net", "x-amz-"] },
  { "slug": "gcp", "label": "Google Cloud", "category": "cloud", "aliases": ["google cloud", "gcp", "bigquery", "cloud run"], "fingerprints": ["googleusercontent.com", "run.app"] },
  { "slug": "azure", "label": "Azure", "category": "cloud", "aliases": ["azure", "microsoft azure"], "fingerprints": ["azurewebsites.net", "azureedge.net"] },
  { "slug": "ovh", "label": "OVHcloud", "category": "cloud", "aliases": ["ovh", "ovhcloud"], "fingerprints": ["ovh.net"] },
  { "slug": "scaleway", "label": "Scaleway", "category": "cloud", "aliases": ["scaleway"], "fingerprints": ["scw.cloud", "scaleway"] },
  { "slug": "cloudflare", "label": "Cloudflare", "category": "cloud", "aliases": ["cloudflare", "cloudflare workers"], "fingerprints": ["server: cloudflare", "cf-ray"] },
  { "slug": "vercel", "label": "Vercel", "category": "cloud", "aliases": ["vercel"], "fingerprints": ["server: vercel", "x-vercel-id"] },
  { "slug": "netlify", "label": "Netlify", "category": "cloud", "aliases": ["netlify"], "fingerprints": ["server: netlify", "x-nf-request-id"] },
  { "slug": "heroku", "label": "Heroku", "category": "cloud", "aliases": ["heroku"], "fingerprints": ["herokuapp.com"] },
  { "slug": "docker", "label": "Docker", "category": "tool", "aliases": ["docker", "conteneurs", "containers", "docker compose"] },
  { "slug": "kubernetes", "label": "Kubernetes", "category": "tool", "aliases": ["kubernetes", "k8s", "helm"] },
  { "slug": "terraform", "label": "Terraform", "category": "tool", "aliases": ["terraform", "opentofu", "infrastructure as code", "iac"] },
  { "slug": "ansible", "label": "Ansible", "category": "tool", "aliases": ["ansible"] },
  { "slug": "github-actions", "label": "GitHub Actions", "category": "tool", "aliases": ["github actions", "github"], "contextRequired": ["github actions", "github.com", "ci/cd", "ci", "workflow", "pipeline"] },
  { "slug": "gitlab", "label": "GitLab", "category": "tool", "aliases": ["gitlab", "gitlab ci"] },
  { "slug": "jenkins", "label": "Jenkins", "category": "tool", "aliases": ["jenkins"] },
  { "slug": "linux", "label": "Linux", "category": "tool", "aliases": ["linux", "debian", "ubuntu"], "fingerprints": ["server: nginx", "server: apache"] },
  { "slug": "nginx", "label": "nginx", "category": "tool", "aliases": ["nginx"], "fingerprints": ["server: nginx"] },
  { "slug": "android", "label": "Android", "category": "framework", "aliases": ["android"] },
  { "slug": "ios", "label": "iOS", "category": "framework", "aliases": ["ios", "swiftui", "xcode"] },
  { "slug": "react-native", "label": "React Native", "category": "framework", "aliases": ["react native", "react-native", "expo"], "contextRequired": ["react native", "react-native", "mobile", "expo.dev", "ios", "android"] },
  { "slug": "tauri", "label": "Tauri", "category": "framework", "aliases": ["tauri"] },
  { "slug": "electron", "label": "Electron", "category": "framework", "aliases": ["electron"], "contextRequired": ["electron.js", "electronjs", "desktop", "application bureau", "javascript", "typescript"] },
  { "slug": "unity", "label": "Unity", "category": "framework", "aliases": ["unity", "unity3d"], "contextRequired": ["unity3d", "jeu", "game", "3d", "moteur", "engine", "c#"] },
  { "slug": "unreal", "label": "Unreal Engine", "category": "framework", "aliases": ["unreal engine", "unreal", "ue5", "ue4"] },
  { "slug": "godot", "label": "Godot", "category": "framework", "aliases": ["godot"] },
  { "slug": "qt", "label": "Qt", "category": "framework", "aliases": ["qt", "qml"], "contextRequired": ["c++", "qml", "qt framework", "qt5", "qt6", "embarqué", "embedded", "desktop"] },
  { "slug": "embedded", "label": "Embarqué", "category": "domain", "aliases": ["embarqué", "embedded", "firmware", "microcontrôleur", "microcontroller", "stm32", "esp32", "arduino", "rtos", "freertos", "zephyr"] },
  { "slug": "iot", "label": "IoT", "category": "domain", "aliases": ["iot", "internet des objets", "internet of things", "objets connectés", "lora", "lorawan", "zigbee", "mqtt"] },
  { "slug": "machine-learning", "label": "Machine learning", "category": "domain", "aliases": ["machine learning", "deep learning", "apprentissage automatique", "data science", "intelligence artificielle", "ia", "ai", "llm", "computer vision", "vision par ordinateur", "nlp"] },
  { "slug": "pytorch", "label": "PyTorch", "category": "framework", "aliases": ["pytorch", "torch"] },
  { "slug": "tensorflow", "label": "TensorFlow", "category": "framework", "aliases": ["tensorflow", "keras"] },
  { "slug": "scikit-learn", "label": "scikit-learn", "category": "framework", "aliases": ["scikit-learn", "scikit learn", "sklearn"] },
  { "slug": "pandas", "label": "pandas", "category": "framework", "aliases": ["pandas", "numpy", "polars"] },
  { "slug": "spark", "label": "Spark", "category": "tool", "aliases": ["apache spark", "spark", "pyspark", "databricks"], "contextRequired": ["apache spark", "pyspark", "databricks", "data", "big data", "hadoop"] },
  { "slug": "airflow", "label": "Airflow", "category": "tool", "aliases": ["airflow", "dagster", "prefect"] },
  { "slug": "dbt", "label": "dbt", "category": "tool", "aliases": ["dbt"], "contextRequired": ["data", "sql", "warehouse", "analytics", "snowflake", "bigquery"] },
  { "slug": "snowflake", "label": "Snowflake", "category": "database", "aliases": ["snowflake"], "contextRequired": ["data", "warehouse", "cloud", "sql", "analytics"] },
  { "slug": "blockchain", "label": "Blockchain", "category": "domain", "aliases": ["blockchain", "web3", "solidity", "smart contract", "smart contracts", "ethereum"] },
  { "slug": "cybersecurity", "label": "Cybersécurité", "category": "domain", "aliases": ["cybersécurité", "cybersecurity", "sécurité informatique", "pentest", "soc analyst", "cryptographie", "cryptography"] },
  { "slug": "devops", "label": "DevOps", "category": "domain", "aliases": ["devops", "sre", "site reliability", "platform engineering"] },
  { "slug": "saas", "label": "SaaS", "category": "domain", "aliases": ["saas", "logiciel en ligne", "plateforme saas"] },
  { "slug": "fintech", "label": "Fintech", "category": "domain", "aliases": ["fintech", "paiement", "payments", "banque en ligne", "regtech"] },
  { "slug": "healthtech", "label": "Santé", "category": "domain", "aliases": ["healthtech", "e-santé", "medtech", "santé numérique", "dispositif médical", "medical device"] },
  { "slug": "gaming", "label": "Jeu vidéo", "category": "domain", "aliases": ["jeu vidéo", "jeux vidéo", "video game", "video games", "game studio", "studio de jeux"] },
  { "slug": "ar-vr", "label": "AR/VR", "category": "domain", "aliases": ["réalité virtuelle", "réalité augmentée", "virtual reality", "augmented reality", "xr", "metaverse"] },
  { "slug": "robotics", "label": "Robotique", "category": "domain", "aliases": ["robotique", "robotics", "ros", "ros2", "drone", "drones"] },
  { "slug": "geospatial", "label": "Géospatial", "category": "domain", "aliases": ["sig", "gis", "géomatique", "cartographie", "postgis", "geospatial", "télédétection", "remote sensing"] },
  { "slug": "opencv", "label": "OpenCV", "category": "framework", "aliases": ["opencv"] },
  { "slug": "cuda", "label": "CUDA", "category": "tool", "aliases": ["cuda", "gpu computing", "calcul gpu"] },
  { "slug": "openapi", "label": "API REST", "category": "tool", "aliases": ["api rest", "rest api", "restful", "openapi", "swagger"] },
  { "slug": "grpc", "label": "gRPC", "category": "tool", "aliases": ["grpc", "protobuf", "protocol buffers"] },
  { "slug": "websocket", "label": "WebSocket", "category": "tool", "aliases": ["websocket", "websockets", "socket.io", "temps réel", "real-time", "realtime"] },
  { "slug": "microservices", "label": "Microservices", "category": "domain", "aliases": ["microservices", "micro-services", "architecture distribuée"] },
  { "slug": "playwright", "label": "Playwright", "category": "tool", "aliases": ["playwright", "cypress", "selenium"] },
  { "slug": "jest", "label": "Jest / Vitest", "category": "tool", "aliases": ["jest", "vitest", "testing library"] },
  { "slug": "figma", "label": "Figma", "category": "tool", "aliases": ["figma"] },
  { "slug": "sap", "label": "SAP", "category": "tool", "aliases": ["sap", "abap"], "contextRequired": ["sap", "erp", "abap", "s/4hana", "hana"] },
  { "slug": "salesforce", "label": "Salesforce", "category": "tool", "aliases": ["salesforce", "apex", "lightning web components"] },
  { "slug": "power-platform", "label": "Power Platform", "category": "tool", "aliases": ["power bi", "power apps", "power automate", "dynamics 365", "sharepoint"] },
  { "slug": "cobol", "label": "COBOL", "category": "language", "aliases": ["cobol", "mainframe"] },
  { "slug": "delphi", "label": "Delphi", "category": "language", "aliases": ["delphi", "pascal"] },
  { "slug": "vba", "label": "VBA", "category": "language", "aliases": ["vba", "visual basic", "vb.net"] },
  { "slug": "plc", "label": "Automatisme", "category": "domain", "aliases": ["automatisme", "automate programmable", "plc", "scada", "siemens tia", "codesys"] },
  { "slug": "vhdl", "label": "VHDL / FPGA", "category": "language", "aliases": ["vhdl", "verilog", "fpga", "systemverilog"] },
  { "slug": "mobile", "label": "Mobile", "category": "domain", "aliases": ["application mobile", "applications mobiles", "mobile app", "mobile apps", "développement mobile", "mobile development"] },
  { "slug": "web", "label": "Web", "category": "domain", "aliases": ["développement web", "web development", "application web", "applications web", "web app", "site web", "front-end", "frontend", "back-end", "backend", "full-stack", "fullstack", "full stack"] }
]
```

- [ ] **Step 5 : `esn-keywords.json` et `crawl-paths.json`**

`packages/core/config/esn-keywords.json` :

```json
[
  "esn", "ssii", "régie", "regie", "portage salarial", "nos consultants", "placement de consultants",
  "sourcing", "chasse de têtes", "chasseur de têtes", "cabinet de recrutement", "intérim", "interim",
  "délégation de personnel", "mise à disposition de consultants", "assistance technique",
  "prestation de services informatiques", "société de services", "société de conseil"
]
```

`packages/core/config/crawl-paths.json` :

```json
[
  "/carrieres", "/carriere", "/careers", "/career", "/jobs", "/job", "/recrutement", "/recrutements",
  "/nous-rejoindre", "/rejoignez-nous", "/join-us", "/join", "/about", "/about-us", "/a-propos",
  "/apropos", "/qui-sommes-nous", "/equipe", "/team", "/notre-equipe", "/technologies", "/technologie",
  "/tech", "/stack", "/blog", "/produits", "/products", "/services", "/solutions"
]
```

- [ ] **Step 6 : `types.ts` et `config.ts`**

`packages/core/src/types.ts` :

```ts
export type TechCategory = 'language' | 'framework' | 'database' | 'cloud' | 'tool' | 'domain';

export type TechTag = {
  slug: string;
  label: string;
  category: TechCategory;
  aliases: string[];
  contextRequired?: string[];
  fingerprints?: string[];
};

export type Detection = {
  slug: string;
  evidence: string;
  confidence: number;
};

export type DetectionSource = 'offre' | 'site' | 'github' | 'manuel';

export type ScoreProfile = {
  skills: string[];
  radiusKm: number;
  headcountRanges: string[];
};

export type ScoreCompany = {
  headcountRange: string | null;
  techs: { slug: string; confidence: number }[];
  /** Pour chaque offre active, les slugs de technos détectées dans l'offre. */
  activeOffers: { techSlugs: string[] }[];
  signals: { kind: string; value: number | null }[];
};

export type ScoreLine = { label: string; points: number };

export type ScoreResult = { score: number; lines: ScoreLine[] };
```

`packages/core/src/config.ts` :

```ts
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
```

Ajouter dans `packages/core/src/index.ts` :

```ts
export * from './config';
export * from './types';
```

- [ ] **Step 7 : vérifier et committer**

Run: `pnpm vitest run packages/core/test/config.test.ts`
Expected: 5 tests passent. Si Zod refuse un slug, corriger l'entrée fautive du JSON (les slugs sont en minuscules, chiffres et tirets).

Run: `pnpm lint:fix`

```bash
git add packages/core
git commit -m "feat(core): configuration d'ingestion, dictionnaire des technos, loaders Zod

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5 : core — détection de technos (mots-clés, contexte, empreintes, ESN)

**Files:**
- Create: `packages/core/src/detect.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/detect.test.ts`

- [ ] **Step 1 : tests**

`packages/core/test/detect.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { loadEsnKeywords, loadTechTags } from '../src/config';
import { detectEsn, detectFingerprints, detectTechs, mergeDetections, splitSentences } from '../src/detect';

const tags = loadTechTags();

describe('splitSentences', () => {
  it('splits on punctuation and newlines and trims', () => {
    expect(splitSentences('Nous utilisons React. Et Python!\nAussi Go.')).toEqual([
      'Nous utilisons React.',
      'Et Python!',
      'Aussi Go.',
    ]);
  });
});

describe('detectTechs', () => {
  it('finds plain aliases with word boundaries', () => {
    const found = detectTechs('Stack : React, Node.js et PostgreSQL.', tags, 0.7);
    const slugs = found.map((d) => d.slug);
    expect(slugs).toContain('react');
    expect(slugs).toContain('nodejs');
    expect(slugs).toContain('postgresql');
    expect(found.find((d) => d.slug === 'react')?.confidence).toBe(0.7);
    expect(found.find((d) => d.slug === 'react')?.evidence).toBe('Stack : React, Node.js et PostgreSQL.');
  });
  it('does not match "reactive" for react', () => {
    expect(detectTechs('Une équipe réactive et proactive.', tags, 0.5)).toEqual([]);
  });
  it('requires context for ambiguous names', () => {
    expect(detectTechs('On y go pour la réunion.', tags, 0.5).map((d) => d.slug)).not.toContain('go');
    expect(detectTechs('Développeur Go confirmé.', tags, 0.5).map((d) => d.slug)).toContain('go');
    expect(detectTechs('Le langage R pour la statistique.', tags, 0.5).map((d) => d.slug)).toContain('r');
    expect(detectTechs('Vitamine C et repos.', tags, 0.5).map((d) => d.slug)).not.toContain('c');
    expect(detectTechs('Développement C/C++ embarqué.', tags, 0.5).map((d) => d.slug)).toContain('c');
  });
  it('is case-insensitive and accent-insensitive on aliases', () => {
    const slugs = detectTechs('CYBERSÉCURITÉ et cybersecurite.', tags, 0.5).map((d) => d.slug);
    expect(slugs).toContain('cybersecurity');
  });
  it('dedupes by slug keeping the first evidence', () => {
    const found = detectTechs('React ici. React là.', tags, 0.5);
    expect(found.filter((d) => d.slug === 'react')).toHaveLength(1);
  });
});

describe('detectFingerprints', () => {
  it('detects Next.js from markup and WordPress from paths', () => {
    const html = '<html><head><script src="/_next/static/chunks/main.js"></script></head><body><div id="__next"></div></body></html>';
    const found = detectFingerprints(html, {}, tags);
    expect(found.map((d) => d.slug)).toContain('nextjs');
    expect(found.find((d) => d.slug === 'nextjs')?.confidence).toBe(0.9);
    const wp = detectFingerprints('<link href="/wp-content/themes/x.css">', {}, tags);
    expect(wp.map((d) => d.slug)).toContain('wordpress');
  });
  it('detects from headers', () => {
    const found = detectFingerprints('<html></html>', { server: 'cloudflare', 'x-powered-by': 'Express' }, tags);
    const slugs = found.map((d) => d.slug);
    expect(slugs).toContain('cloudflare');
    expect(slugs).toContain('nodejs');
  });
});

describe('mergeDetections', () => {
  it('keeps the best confidence per slug', () => {
    const merged = mergeDetections(
      [{ slug: 'react', evidence: 'a', confidence: 0.5 }],
      [{ slug: 'react', evidence: 'b', confidence: 0.9 }, { slug: 'vue', evidence: 'c', confidence: 0.5 }],
    );
    expect(merged).toEqual([
      { slug: 'react', evidence: 'b', confidence: 0.9 },
      { slug: 'vue', evidence: 'c', confidence: 0.5 },
    ]);
  });
});

describe('detectEsn', () => {
  const keywords = loadEsnKeywords();
  it('returns the sentence containing an ESN keyword', () => {
    expect(detectEsn('Nous sommes une ESN à taille humaine. Rejoignez-nous.', keywords)).toBe(
      'Nous sommes une ESN à taille humaine.',
    );
  });
  it('returns null otherwise', () => {
    expect(detectEsn('Nous éditons un logiciel de gestion.', keywords)).toBeNull();
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `pnpm vitest run packages/core/test/detect.test.ts`
Expected: FAIL, module `../src/detect` introuvable.

- [ ] **Step 3 : implémentation**

`packages/core/src/detect.ts` :

```ts
import { stripAccents } from './normalize';
import type { Detection, TechTag } from './types';

const MAX_EVIDENCE = 200;

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function fold(input: string): string {
  return stripAccents(input).toLowerCase();
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Frontière de mot tolérante aux caractères comme "#", "+" ou "." en fin d'alias. */
function aliasRegex(alias: string): RegExp {
  const escaped = escapeRegex(fold(alias));
  const startsWithWord = /^[a-z0-9]/.test(alias);
  const endsWithWord = /[a-z0-9]$/.test(fold(alias));
  const start = startsWithWord ? '(?<![a-z0-9])' : '';
  const end = endsWithWord ? '(?![a-z0-9])' : '(?![a-z0-9+#])';
  return new RegExp(`${start}${escaped}${end}`, 'i');
}

type CompiledTag = { tag: TechTag; aliases: RegExp[]; context: string[] | null };

const cache = new WeakMap<TechTag[], CompiledTag[]>();

function compile(tags: TechTag[]): CompiledTag[] {
  const cached = cache.get(tags);
  if (cached) return cached;
  const compiled = tags.map((tag) => ({
    tag,
    aliases: tag.aliases.map(aliasRegex),
    context: tag.contextRequired ? tag.contextRequired.map(fold) : null,
  }));
  cache.set(tags, compiled);
  return compiled;
}

function truncate(sentence: string): string {
  return sentence.length > MAX_EVIDENCE ? `${sentence.slice(0, MAX_EVIDENCE - 1)}…` : sentence;
}

/** Détecte les technos d'un texte visible, phrase par phrase. Une entrée par slug, première preuve. */
export function detectTechs(text: string, tags: TechTag[], confidence: number): Detection[] {
  const found = new Map<string, Detection>();
  const compiled = compile(tags);
  for (const sentence of splitSentences(text)) {
    const folded = fold(sentence);
    for (const { tag, aliases, context } of compiled) {
      if (found.has(tag.slug)) continue;
      if (!aliases.some((re) => re.test(folded))) continue;
      if (context && !context.some((c) => folded.includes(c))) continue;
      found.set(tag.slug, { slug: tag.slug, evidence: truncate(sentence), confidence });
    }
  }
  return [...found.values()];
}

/** Détecte les technos par empreintes dans le HTML brut et les en-têtes HTTP. */
export function detectFingerprints(html: string, headers: Record<string, string>, tags: TechTag[]): Detection[] {
  const haystack = html.toLowerCase();
  const headerLines = Object.entries(headers).map(([k, v]) => `${k.toLowerCase()}: ${v.toLowerCase()}`);
  const found: Detection[] = [];
  for (const tag of tags) {
    if (!tag.fingerprints || tag.fingerprints.length === 0) continue;
    const hit = tag.fingerprints.find((fp) => haystack.includes(fp) || headerLines.some((h) => h.includes(fp)));
    if (hit) found.push({ slug: tag.slug, evidence: `empreinte : ${hit}`, confidence: 0.9 });
  }
  return found;
}

/** Fusionne plusieurs listes en gardant, par slug, la meilleure confiance. */
export function mergeDetections(...lists: Detection[][]): Detection[] {
  const best = new Map<string, Detection>();
  for (const list of lists) {
    for (const d of list) {
      const current = best.get(d.slug);
      if (!current || d.confidence > current.confidence) best.set(d.slug, d);
    }
  }
  return [...best.values()];
}

/** Renvoie la première phrase contenant un mot-clé ESN, sinon null. */
export function detectEsn(text: string, keywords: string[]): string | null {
  const regexes = keywords.map(aliasRegex);
  for (const sentence of splitSentences(text)) {
    const folded = fold(sentence);
    if (regexes.some((re) => re.test(folded))) return truncate(sentence);
  }
  return null;
}
```

Ajouter `export * from './detect';` dans `packages/core/src/index.ts`.

- [ ] **Step 4 : vérifier**

Run: `pnpm vitest run packages/core/test/detect.test.ts`
Expected: tous les tests passent. Points de vigilance :
- `'Vitamine C et repos.'` : l'alias `c` matche mais aucun contexte n'est présent, donc rien.
- `'Développement C/C++ embarqué.'` : le contexte `c/c++` est présent.
- `'CYBERSÉCURITÉ'` : `fold` retire les accents des deux côtés.
- Si `detectTechs('Une équipe réactive…')` renvoie `react`, vérifier que `aliasRegex` ajoute bien `(?![a-z0-9])` en fin.

- [ ] **Step 5 : commit**

```bash
git add packages/core
git commit -m "feat(core): détection de technos par mots-clés, contexte, empreintes et ESN

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6 : core — scoring

**Files:**
- Create: `packages/core/src/score.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/score.test.ts`

- [ ] **Step 1 : tests**

`packages/core/test/score.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { scoreCompany } from '../src/score';
import type { ScoreCompany, ScoreProfile } from '../src/types';

const profile: ScoreProfile = { skills: ['react', 'typescript', 'postgresql'], radiusKm: 30, headcountRanges: ['11', '12'] };

const base: ScoreCompany = { headcountRange: '12', techs: [], activeOffers: [], signals: [] };

describe('scoreCompany', () => {
  it('gives 0 with no match and max distance', () => {
    const r = scoreCompany(profile, { ...base, headcountRange: '53' }, 30);
    expect(r.score).toBe(0);
    expect(r.lines).toEqual([]);
  });
  it('scores tech overlap with best confidence, capped at 4 points of confidence', () => {
    const r = scoreCompany(
      profile,
      { ...base, headcountRange: null, techs: [{ slug: 'react', confidence: 0.9 }, { slug: 'typescript', confidence: 0.5 }, { slug: 'go', confidence: 0.9 }] },
      30,
    );
    // (0.9 + 0.5) / 4 * 40 = 14
    expect(r.lines).toContainEqual({ label: '2 technos communes', points: 14 });
    expect(r.score).toBe(14);
  });
  it('scores proximity linearly', () => {
    expect(scoreCompany(profile, { ...base, headcountRange: null }, 0).lines).toContainEqual({ label: '0 km', points: 20 });
    expect(scoreCompany(profile, { ...base, headcountRange: null }, 15).lines).toContainEqual({ label: '15 km', points: 10 });
  });
  it('scores headcount fit', () => {
    expect(scoreCompany(profile, base, 30).lines).toContainEqual({ label: 'Taille souhaitée (20 à 49 salariés)', points: 15 });
  });
  it('scores active offers: 15 if one matches a skill, 8 otherwise', () => {
    expect(scoreCompany(profile, { ...base, headcountRange: null, activeOffers: [{ techSlugs: ['react'] }] }, 30).lines).toContainEqual({
      label: '1 offre active correspondant au profil',
      points: 15,
    });
    expect(scoreCompany(profile, { ...base, headcountRange: null, activeOffers: [{ techSlugs: ['php'] }, { techSlugs: [] }] }, 30).lines).toContainEqual({
      label: '2 offres actives',
      points: 8,
    });
  });
  it('scores signals and caps them at 10', () => {
    const r = scoreCompany(
      profile,
      {
        ...base,
        headcountRange: null,
        signals: [
          { kind: 'hired_last_12_months', value: 3 },
          { kind: 'github_active', value: 1 },
          { kind: 'revenue_growth', value: 12 },
        ],
      },
      30,
    );
    expect(r.lines).toContainEqual({ label: 'A recruté sur 12 mois (3 offres)', points: 4 });
    expect(r.lines).toContainEqual({ label: 'GitHub actif', points: 3 });
    expect(r.lines).toContainEqual({ label: 'Chiffre d’affaires en hausse (+12 %)', points: 3 });
    expect(r.score).toBe(10);
  });
  it('penalises suspected ESN and never goes below 0', () => {
    const r = scoreCompany(profile, { ...base, headcountRange: null, signals: [{ kind: 'esn_suspected', value: null }] }, 30);
    expect(r.lines).toContainEqual({ label: 'ESN suspectée', points: -20 });
    expect(r.score).toBe(0);
  });
  it('rounds the total', () => {
    const r = scoreCompany(profile, { ...base, techs: [{ slug: 'react', confidence: 0.7 }] }, 7);
    // 7 + 15.33 + 15 = 37.33 -> 37
    expect(r.score).toBe(37);
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `pnpm vitest run packages/core/test/score.test.ts`
Expected: FAIL, module `../src/score` introuvable.

- [ ] **Step 3 : implémentation**

`packages/core/src/score.ts` :

```ts
import { HEADCOUNT_LABELS } from './config';
import type { ScoreCompany, ScoreLine, ScoreProfile, ScoreResult } from './types';

const TECH_MAX = 40;
const TECH_CONFIDENCE_CAP = 4;
const DISTANCE_MAX = 20;
const HEADCOUNT_MAX = 15;
const OFFER_MATCH = 15;
const OFFER_NO_MATCH = 8;
const SIGNALS_MAX = 10;
const ESN_PENALTY = -20;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function scoreCompany(profile: ScoreProfile, company: ScoreCompany, distanceKm: number): ScoreResult {
  const lines: ScoreLine[] = [];
  const skills = new Set(profile.skills);

  // Technos communes : meilleure confiance par slug, somme plafonnée.
  const best = new Map<string, number>();
  for (const t of company.techs) {
    if (!skills.has(t.slug)) continue;
    best.set(t.slug, Math.max(best.get(t.slug) ?? 0, t.confidence));
  }
  if (best.size > 0) {
    const sum = Math.min(TECH_CONFIDENCE_CAP, [...best.values()].reduce((a, b) => a + b, 0));
    const points = round1((sum / TECH_CONFIDENCE_CAP) * TECH_MAX);
    lines.push({ label: `${best.size} techno${best.size > 1 ? 's' : ''} commune${best.size > 1 ? 's' : ''}`, points });
  }

  // Proximité.
  if (profile.radiusKm > 0 && distanceKm < profile.radiusKm) {
    const points = round1(DISTANCE_MAX * (1 - distanceKm / profile.radiusKm));
    lines.push({ label: `${Math.round(distanceKm)} km`, points });
  }

  // Taille.
  if (company.headcountRange && profile.headcountRanges.includes(company.headcountRange)) {
    const label = HEADCOUNT_LABELS[company.headcountRange] ?? company.headcountRange;
    lines.push({ label: `Taille souhaitée (${label})`, points: HEADCOUNT_MAX });
  }

  // Offres actives.
  const active = company.activeOffers.length;
  if (active > 0) {
    const matching = company.activeOffers.filter((o) => o.techSlugs.some((s) => skills.has(s))).length;
    if (matching > 0) {
      lines.push({ label: `${matching} offre${matching > 1 ? 's' : ''} active${matching > 1 ? 's' : ''} correspondant au profil`, points: OFFER_MATCH });
    } else {
      lines.push({ label: `${active} offre${active > 1 ? 's' : ''} active${active > 1 ? 's' : ''}`, points: OFFER_NO_MATCH });
    }
  }

  // Signaux récents, plafonnés.
  let signalPoints = 0;
  const signalLines: ScoreLine[] = [];
  for (const s of company.signals) {
    if (s.kind === 'hired_last_12_months' && (s.value ?? 0) > 0) {
      signalLines.push({ label: `A recruté sur 12 mois (${s.value} offre${(s.value ?? 0) > 1 ? 's' : ''})`, points: 4 });
    } else if (s.kind === 'github_active') {
      signalLines.push({ label: 'GitHub actif', points: 3 });
    } else if (s.kind === 'revenue_growth' && (s.value ?? 0) > 0) {
      signalLines.push({ label: `Chiffre d’affaires en hausse (+${Math.round(s.value ?? 0)} %)`, points: 3 });
    }
  }
  for (const l of signalLines) {
    if (signalPoints >= SIGNALS_MAX) break;
    const points = Math.min(l.points, SIGNALS_MAX - signalPoints);
    signalPoints += points;
    lines.push({ ...l, points });
  }

  // ESN.
  if (company.signals.some((s) => s.kind === 'esn_suspected')) {
    lines.push({ label: 'ESN suspectée', points: ESN_PENALTY });
  }

  const total = lines.reduce((a, l) => a + l.points, 0);
  return { score: Math.max(0, Math.round(total)), lines };
}
```

Ajouter `export * from './score';` dans `packages/core/src/index.ts`.

- [ ] **Step 4 : vérifier**

Run: `pnpm vitest run packages/core`
Expected: tous les tests de `core` passent. Pour « rounds the total » : 7 km sur 30 donne 15.3, plus 7 pour la techno (0.7/4×40), plus 15 pour la taille = 37.3, arrondi 37.

- [ ] **Step 5 : commit**

```bash
git add packages/core
git commit -m "feat(core): scoring des entreprises avec explication ligne par ligne

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7 : db — schéma Drizzle, client SQLite, migrations, seed, module géographique

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`
- Create: `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/src/migrate.ts`, `packages/db/src/geo.ts`, `packages/db/src/queries.ts`, `packages/db/src/index.ts`
- Create: `packages/db/test/helpers.ts`, `packages/db/test/schema.test.ts`, `packages/db/test/geo.test.ts`, `packages/db/test/queries.test.ts`
- Generated: `packages/db/drizzle/0000_*.sql`, `packages/db/drizzle/meta/*`

- [ ] **Step 1 : paquet**

`packages/db/package.json` :

```json
{
  "name": "@novi/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "generate": "drizzle-kit generate",
    "migrate": "tsx src/migrate.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@novi/core": "workspace:*",
    "better-sqlite3": "^13.0.3",
    "dotenv": "^18.0.4",
    "drizzle-orm": "^0.45.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^9.6.0",
    "drizzle-kit": "^0.31.11",
    "tsx": "^4.23.15",
    "typescript": "^5.9.3",
    "vitest": "^5.0.2"
  }
}
```

`packages/db/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test", "drizzle.config.ts"]
}
```

`packages/db/drizzle.config.ts` :

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url: '../../data/novi.db' },
});
```

Run: `pnpm install`
Expected: `better-sqlite3` s'installe avec un binaire précompilé (message `Done`). Si la compilation native échoue, installer les Build Tools Visual Studio ou vérifier que Node est en version 22 ou plus.

- [ ] **Step 2 : schéma**

`packages/db/src/schema.ts` :

```ts
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const now = () => new Date().toISOString();

const timestamps = {
  createdAt: text('created_at').notNull().$defaultFn(now),
  updatedAt: text('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
};

export type Finances = Record<string, { ca: number | null; resultat_net: number | null }>;

export const companies = sqliteTable(
  'companies',
  {
    siren: text('siren').primaryKey(),
    name: text('name').notNull(),
    legalName: text('legal_name').notNull(),
    tradeNames: text('trade_names', { mode: 'json' }).$type<string[]>().notNull().default([]),
    nafCode: text('naf_code').notNull(),
    nafLabel: text('naf_label'),
    headcountRange: text('headcount_range'),
    headcountYear: text('headcount_year'),
    companyCategory: text('company_category'),
    foundedAt: text('founded_at'),
    siretLocal: text('siret_local').notNull(),
    address: text('address'),
    postalCode: text('postal_code'),
    city: text('city'),
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    headquartersInZone: integer('headquarters_in_zone', { mode: 'boolean' }).notNull().default(true),
    finances: text('finances', { mode: 'json' }).$type<Finances>(),
    website: text('website'),
    websiteSource: text('website_source', { enum: ['offre', 'osm', 'devinette', 'manuel'] }),
    websiteConfidence: real('website_confidence'),
    careersUrl: text('careers_url'),
    githubOrg: text('github_org'),
    linkedinUrl: text('linkedin_url'),
    description: text('description'),
    lastCrawledAt: text('last_crawled_at'),
    rawSirene: text('raw_sirene', { mode: 'json' }).$type<unknown>(),
    ...timestamps,
  },
  (t) => [index('companies_lat_lon').on(t.latitude, t.longitude), index('companies_naf').on(t.nafCode)],
);

export const techTags = sqliteTable('tech_tags', {
  slug: text('slug').primaryKey(),
  label: text('label').notNull(),
  category: text('category').notNull(),
  aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull(),
  contextRequired: text('context_required', { mode: 'json' }).$type<string[]>(),
  ...timestamps,
});

export const companyTech = sqliteTable(
  'company_tech',
  {
    siren: text('siren').notNull().references(() => companies.siren, { onDelete: 'cascade' }),
    tagSlug: text('tag_slug').notNull().references(() => techTags.slug, { onDelete: 'cascade' }),
    source: text('source', { enum: ['offre', 'site', 'github', 'manuel'] }).notNull(),
    confidence: real('confidence').notNull(),
    evidence: text('evidence'),
    detectedAt: text('detected_at').notNull().$defaultFn(now),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.siren, t.tagSlug, t.source] }), index('company_tech_tag').on(t.tagSlug)],
);

export const jobOffers = sqliteTable(
  'job_offers',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull().default('france_travail'),
    siren: text('siren').references(() => companies.siren, { onDelete: 'set null' }),
    employerName: text('employer_name'),
    title: text('title').notNull(),
    description: text('description'),
    url: text('url'),
    contractType: text('contract_type'),
    publishedAt: text('published_at'),
    updatedAtSource: text('updated_at_source'),
    latitude: real('latitude'),
    longitude: real('longitude'),
    city: text('city'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    lastSeenRunId: integer('last_seen_run_id'),
    raw: text('raw', { mode: 'json' }).$type<unknown>(),
    ...timestamps,
  },
  (t) => [index('job_offers_siren').on(t.siren), index('job_offers_active').on(t.isActive)],
);

export const employerAliases = sqliteTable('employer_aliases', {
  employerNameNormalized: text('employer_name_normalized').primaryKey(),
  siren: text('siren').notNull().references(() => companies.siren, { onDelete: 'cascade' }),
  ...timestamps,
});

export const SIGNAL_KINDS = [
  'recruiting_now',
  'hired_last_12_months',
  'careers_page_found',
  'github_active',
  'revenue_growth',
  'esn_suspected',
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const signals = sqliteTable(
  'signals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siren: text('siren').notNull().references(() => companies.siren, { onDelete: 'cascade' }),
    kind: text('kind', { enum: SIGNAL_KINDS }).notNull(),
    value: real('value'),
    evidence: text('evidence'),
    detectedAt: text('detected_at').notNull().$defaultFn(now),
    ...timestamps,
  },
  (t) => [index('signals_siren_kind').on(t.siren, t.kind)],
);

export const profiles = sqliteTable('profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  homeLabel: text('home_label').notNull(),
  homeLatitude: real('home_latitude').notNull(),
  homeLongitude: real('home_longitude').notNull(),
  radiusKm: real('radius_km').notNull(),
  skills: text('skills', { mode: 'json' }).$type<string[]>().notNull().default([]),
  headcountRanges: text('headcount_ranges', { mode: 'json' }).$type<string[]>().notNull().default([]),
  ...timestamps,
});

export const COMPANY_STATUSES = ['to_review', 'interested', 'contacted', 'rejected', 'ignored'] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const companyStatus = sqliteTable(
  'company_status',
  {
    profileId: integer('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    siren: text('siren').notNull().references(() => companies.siren, { onDelete: 'cascade' }),
    status: text('status', { enum: COMPANY_STATUSES }).notNull().default('to_review'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.profileId, t.siren] })],
);

export type RunStats = { processed: number; created: number; updated: number; errors: number; [k: string]: number };
export type RunError = { siren?: string; message: string };

export const crawlRuns = sqliteTable('crawl_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  command: text('command').notNull(),
  args: text('args', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  startedAt: text('started_at').notNull().$defaultFn(now),
  finishedAt: text('finished_at'),
  stats: text('stats', { mode: 'json' }).$type<RunStats>(),
  errors: text('errors', { mode: 'json' }).$type<RunError[]>().notNull().default([]),
});

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type JobOffer = typeof jobOffers.$inferSelect;
export type NewJobOffer = typeof jobOffers.$inferInsert;
export type Signal = typeof signals.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type CompanyTechRow = typeof companyTech.$inferSelect;
export type CrawlRun = typeof crawlRuns.$inferSelect;
```

- [ ] **Step 3 : client**

`packages/db/src/client.ts` :

```ts
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { distanceKm } from '@novi/core';
import Database from 'better-sqlite3';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export function findRepoRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export const DEFAULT_DB_URL = 'file:./data/novi.db';

export function resolveDbPath(url = process.env.DATABASE_URL ?? DEFAULT_DB_URL): string {
  const stripped = url.startsWith('file:') ? url.slice('file:'.length) : url;
  if (stripped === ':memory:') return stripped;
  const path = resolve(findRepoRoot(), stripped);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

export function createDb(url?: string) {
  loadEnv({ path: join(findRepoRoot(), '.env'), quiet: true });
  const sqlite = new Database(resolveDbPath(url));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.function('distance_km', { deterministic: true }, (lat1, lon1, lat2, lon2) =>
    distanceKm(
      { latitude: Number(lat1), longitude: Number(lon1) },
      { latitude: Number(lat2), longitude: Number(lon2) },
    ),
  );
  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof createDb>;

let singleton: Db | null = null;

export function getDb(): Db {
  if (!singleton) singleton = createDb();
  return singleton;
}
```

- [ ] **Step 4 : requêtes partagées**

`packages/db/src/queries.ts` :

```ts
import { type Detection, type DetectionSource, type TechTag, normalizeCompanyName } from '@novi/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './client';
import { companies, companyTech, employerAliases, profiles, type SignalKind, signals, techTags } from './schema';

export function syncTechTags(db: Db, tags: TechTag[]): void {
  db.transaction((tx) => {
    for (const t of tags) {
      tx.insert(techTags)
        .values({ slug: t.slug, label: t.label, category: t.category, aliases: t.aliases, contextRequired: t.contextRequired ?? null })
        .onConflictDoUpdate({
          target: techTags.slug,
          set: { label: t.label, category: t.category, aliases: t.aliases, contextRequired: t.contextRequired ?? null },
        })
        .run();
    }
  });
}

export const DEFAULT_PROFILE = {
  name: 'Moi',
  homeLabel: 'Nice',
  homeLatitude: 43.7102,
  homeLongitude: 7.262,
  radiusKm: 30,
  skills: [] as string[],
  headcountRanges: ['03', '11', '12', '21', '22'],
};

export function ensureDefaultProfile(db: Db) {
  const existing = db.select().from(profiles).limit(1).get();
  if (existing) return existing;
  return db.insert(profiles).values(DEFAULT_PROFILE).returning().get();
}

export function getDefaultProfile(db: Db) {
  return ensureDefaultProfile(db);
}

/** Remplace toutes les technos d'une entreprise pour une source donnée. */
export function replaceCompanyTech(db: Db, siren: string, source: DetectionSource, detections: Detection[]): void {
  db.transaction((tx) => {
    tx.delete(companyTech).where(and(eq(companyTech.siren, siren), eq(companyTech.source, source))).run();
    for (const d of detections) {
      tx.insert(companyTech)
        .values({ siren, tagSlug: d.slug, source, confidence: d.confidence, evidence: d.evidence })
        .onConflictDoNothing()
        .run();
    }
  });
}

/** Ajoute des technos sans supprimer les existantes ; garde la meilleure confiance. */
export function upsertCompanyTech(db: Db, siren: string, source: DetectionSource, detections: Detection[]): void {
  db.transaction((tx) => {
    for (const d of detections) {
      tx.insert(companyTech)
        .values({ siren, tagSlug: d.slug, source, confidence: d.confidence, evidence: d.evidence })
        .onConflictDoUpdate({
          target: [companyTech.siren, companyTech.tagSlug, companyTech.source],
          set: {
            confidence: sql`max(${companyTech.confidence}, ${d.confidence})`,
            evidence: sql`case when ${d.confidence} > ${companyTech.confidence} then ${d.evidence} else ${companyTech.evidence} end`,
          },
        })
        .run();
    }
  });
}

/** Remplace, pour une entreprise, les signaux des types donnés. */
export function replaceSignals(
  db: Db,
  siren: string,
  kinds: SignalKind[],
  rows: { kind: SignalKind; value: number | null; evidence: string | null }[],
): void {
  db.transaction((tx) => {
    tx.delete(signals).where(and(eq(signals.siren, siren), inArray(signals.kind, kinds))).run();
    for (const r of rows) tx.insert(signals).values({ siren, ...r }).run();
  });
}

export function findAlias(db: Db, employerName: string): string | null {
  const row = db
    .select({ siren: employerAliases.siren })
    .from(employerAliases)
    .where(eq(employerAliases.employerNameNormalized, normalizeCompanyName(employerName)))
    .get();
  return row?.siren ?? null;
}

export function saveAlias(db: Db, employerName: string, siren: string): void {
  db.insert(employerAliases)
    .values({ employerNameNormalized: normalizeCompanyName(employerName), siren })
    .onConflictDoUpdate({ target: employerAliases.employerNameNormalized, set: { siren } })
    .run();
}

export function companyExists(db: Db, siren: string): boolean {
  return db.select({ siren: companies.siren }).from(companies).where(eq(companies.siren, siren)).get() !== undefined;
}
```

- [ ] **Step 5 : module géographique**

`packages/db/src/geo.ts` :

```ts
import type { Point } from '@novi/core';
import { and, asc, between, getTableColumns, sql } from 'drizzle-orm';
import type { Db } from './client';
import { type Company, companies } from './schema';

export type CompanyWithDistance = Company & { distanceKm: number };

const KM_PER_DEGREE_LAT = 111.32;

/**
 * Entreprises à moins de `radiusKm` du point, triées par distance.
 * Seule fonction à réécrire avec PostGIS (ST_DWithin) lors du passage à Postgres.
 */
export function companiesWithinRadius(db: Db, center: Point, radiusKm: number): CompanyWithDistance[] {
  const dLat = radiusKm / KM_PER_DEGREE_LAT;
  const dLon = radiusKm / (KM_PER_DEGREE_LAT * Math.cos((center.latitude * Math.PI) / 180));
  const distance = sql<number>`distance_km(${center.latitude}, ${center.longitude}, ${companies.latitude}, ${companies.longitude})`;
  return db
    .select({ ...getTableColumns(companies), distanceKm: distance })
    .from(companies)
    .where(
      and(
        between(companies.latitude, center.latitude - dLat, center.latitude + dLat),
        between(companies.longitude, center.longitude - dLon, center.longitude + dLon),
        sql`${distance} <= ${radiusKm}`,
      ),
    )
    .orderBy(asc(distance))
    .all() as CompanyWithDistance[];
}
```

- [ ] **Step 6 : migrations et seed**

`packages/db/src/migrate.ts` :

```ts
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTechTags } from '@novi/core';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { type Db, getDb, resolveDbPath } from './client';
import { ensureDefaultProfile, syncTechTags } from './queries';

const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', 'drizzle');

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

export function seed(db: Db): void {
  syncTechTags(db, loadTechTags());
  ensureDefaultProfile(db);
}

export function migrateAndSeed(db: Db): void {
  runMigrations(db);
  seed(db);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = getDb();
  migrateAndSeed(db);
  console.log(`Base migrée et initialisée : ${resolveDbPath()}`);
}
```

`packages/db/src/index.ts` :

```ts
export * from './client';
export * from './geo';
export { migrateAndSeed, runMigrations, seed } from './migrate';
export * from './queries';
export * from './schema';
```

Générer la migration :

Run: `pnpm db:generate`
Expected: `packages/db/drizzle/0000_<nom>.sql` et `packages/db/drizzle/meta/` créés, sortie `[✓] Your SQL migration file ➜ drizzle/0000_....sql`.

Run: `pnpm db:migrate`
Expected: `Base migrée et initialisée : C:\Users\tomba\Downloads\Novi\data\novi.db`. Le dossier `data/` est ignoré par git.

- [ ] **Step 7 : tests**

`packages/db/test/helpers.ts` :

```ts
import { createDb, type Db, migrateAndSeed } from '../src';
import type { NewCompany } from '../src/schema';

export function createTestDb(): Db {
  const db = createDb(':memory:');
  migrateAndSeed(db);
  return db;
}

export function company(overrides: Partial<NewCompany> & Pick<NewCompany, 'siren'>): NewCompany {
  return {
    name: `Entreprise ${overrides.siren}`,
    legalName: `ENTREPRISE ${overrides.siren}`,
    nafCode: '62.01Z',
    siretLocal: `${overrides.siren}00010`,
    latitude: 43.7102,
    longitude: 7.262,
    ...overrides,
  };
}
```

`packages/db/test/schema.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { companies, profiles, techTags } from '../src/schema';
import { createTestDb } from './helpers';

describe('migrations and seed', () => {
  it('creates tables, seeds tech tags and a default profile', () => {
    const db = createTestDb();
    expect(db.select().from(techTags).all().length).toBeGreaterThan(100);
    const profile = db.select().from(profiles).get();
    expect(profile?.homeLabel).toBe('Nice');
    expect(profile?.radiusKm).toBe(30);
    expect(db.select().from(companies).all()).toEqual([]);
  });
});
```

`packages/db/test/geo.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { companiesWithinRadius } from '../src/geo';
import { companies } from '../src/schema';
import { company, createTestDb } from './helpers';

describe('companiesWithinRadius', () => {
  it('returns companies inside the radius sorted by distance', () => {
    const db = createTestDb();
    db.insert(companies)
      .values([
        company({ siren: '000000001', name: 'Nice centre', latitude: 43.7102, longitude: 7.262 }),
        company({ siren: '000000002', name: 'Sophia', latitude: 43.6161, longitude: 7.0553 }),
        company({ siren: '000000003', name: 'Marseille', latitude: 43.2965, longitude: 5.3698 }),
      ])
      .run();
    const rows = companiesWithinRadius(db, { latitude: 43.7102, longitude: 7.262 }, 30);
    expect(rows.map((r) => r.name)).toEqual(['Nice centre', 'Sophia']);
    expect(rows[0]?.distanceKm).toBe(0);
    expect(rows[1]?.distanceKm).toBeGreaterThan(18);
    expect(rows[1]?.distanceKm).toBeLessThan(21);
  });
});
```

`packages/db/test/queries.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { findAlias, replaceCompanyTech, replaceSignals, saveAlias, upsertCompanyTech } from '../src/queries';
import { companies, companyTech, signals } from '../src/schema';
import { company, createTestDb } from './helpers';

describe('company tech helpers', () => {
  it('upsert keeps the best confidence and replace wipes a source', () => {
    const db = createTestDb();
    db.insert(companies).values(company({ siren: '000000001' })).run();
    upsertCompanyTech(db, '000000001', 'offre', [{ slug: 'react', evidence: 'a', confidence: 0.5 }]);
    upsertCompanyTech(db, '000000001', 'offre', [{ slug: 'react', evidence: 'b', confidence: 0.9 }]);
    upsertCompanyTech(db, '000000001', 'offre', [{ slug: 'react', evidence: 'c', confidence: 0.3 }]);
    const row = db.select().from(companyTech).get();
    expect(row?.confidence).toBe(0.9);
    expect(row?.evidence).toBe('b');
    replaceCompanyTech(db, '000000001', 'site', [{ slug: 'vue', evidence: 's', confidence: 0.7 }]);
    replaceCompanyTech(db, '000000001', 'site', [{ slug: 'nuxt', evidence: 's', confidence: 0.9 }]);
    const slugs = db.select().from(companyTech).all().map((r) => `${r.source}:${r.tagSlug}`).sort();
    expect(slugs).toEqual(['offre:react', 'site:nuxt']);
  });
});

describe('signals and aliases', () => {
  it('replaceSignals only touches the given kinds', () => {
    const db = createTestDb();
    db.insert(companies).values(company({ siren: '000000001' })).run();
    replaceSignals(db, '000000001', ['esn_suspected'], [{ kind: 'esn_suspected', value: null, evidence: 'régie' }]);
    replaceSignals(db, '000000001', ['recruiting_now'], [{ kind: 'recruiting_now', value: 2, evidence: null }]);
    replaceSignals(db, '000000001', ['recruiting_now'], [{ kind: 'recruiting_now', value: 3, evidence: null }]);
    const rows = db.select().from(signals).all();
    expect(rows.map((r) => [r.kind, r.value])).toEqual([
      ['esn_suspected', null],
      ['recruiting_now', 3],
    ]);
  });
  it('aliases are looked up by normalized name', () => {
    const db = createTestDb();
    db.insert(companies).values(company({ siren: '000000001' })).run();
    saveAlias(db, 'CLIKEN WEB SAS', '000000001');
    expect(findAlias(db, 'cliken web')).toBe('000000001');
    expect(findAlias(db, 'autre')).toBeNull();
  });
});
```

Run: `pnpm vitest run packages/db`
Expected: 4 fichiers, tous verts. Si `distance_km` est inconnu, vérifier que `createDb` enregistre bien la fonction avant `drizzle(...)`. Si `import.meta.dirname` est `undefined`, Node est trop ancien (il faut 20.11+).

- [ ] **Step 8 : commit**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): schéma Drizzle, client SQLite, migrations, seed et rayon géographique

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8 : pipeline — squelette CLI, journal des runs, limiteur de débit, HTTP

**Files:**
- Create: `packages/pipeline/package.json`, `packages/pipeline/tsconfig.json`
- Create: `packages/pipeline/src/lib/env.ts`, `packages/pipeline/src/lib/logger.ts`, `packages/pipeline/src/lib/rate-limit.ts`, `packages/pipeline/src/lib/http.ts`, `packages/pipeline/src/lib/run.ts`
- Create: `packages/pipeline/src/cli.ts`, `packages/pipeline/src/index.ts`
- Test: `packages/pipeline/test/rate-limit.test.ts`, `packages/pipeline/test/run.test.ts`

- [ ] **Step 1 : paquet**

`packages/pipeline/package.json` :

```json
{
  "name": "@novi/pipeline",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run" },
  "dependencies": {
    "@novi/core": "workspace:*",
    "@novi/db": "workspace:*",
    "cheerio": "^1.2.0",
    "commander": "^15.0.0",
    "dotenv": "^18.0.4",
    "drizzle-orm": "^0.45.3",
    "p-limit": "^7.3.3",
    "robots-parser": "^3.0.1",
    "zod": "^4.6.5"
  },
  "devDependencies": { "tsx": "^4.23.15", "typescript": "^5.9.3", "vitest": "^5.0.2" }
}
```

`packages/pipeline/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Run: `pnpm install`

- [ ] **Step 2 : env et logger**

`packages/pipeline/src/lib/env.ts` :

```ts
import { join } from 'node:path';
import { findRepoRoot } from '@novi/db';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: join(findRepoRoot(), '.env'), quiet: true });

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name} (voir .env.example)`);
  return value;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}
```

`packages/pipeline/src/lib/logger.ts` :

```ts
export function log(message: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
}

export function warn(message: string): void {
  console.warn(`[${new Date().toISOString().slice(11, 19)}] ⚠ ${message}`);
}
```

- [ ] **Step 3 : test du limiteur**

`packages/pipeline/test/rate-limit.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { createLimiter, sleep } from '../src/lib/rate-limit';

describe('createLimiter', () => {
  it('spaces calls by at least 1/perSecond', async () => {
    const limiter = createLimiter(20); // 50 ms
    const t0 = Date.now();
    await limiter(async () => 1);
    await limiter(async () => 2);
    await limiter(async () => 3);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
  });
  it('returns the wrapped result', async () => {
    const limiter = createLimiter(1000);
    expect(await limiter(async () => 'ok')).toBe('ok');
  });
  it('sleep resolves', async () => {
    await expect(sleep(5)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4 : limiteur**

`packages/pipeline/src/lib/rate-limit.ts` :

```ts
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

/** Sérialise les appels et impose un intervalle minimal de 1000/perSecond ms entre deux départs. */
export function createLimiter(perSecond: number): Limiter {
  const interval = 1000 / perSecond;
  let last = 0;
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(async () => {
      const wait = last + interval - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      return fn();
    });
    queue = next.catch(() => undefined);
    return next;
  };
}
```

Run: `pnpm vitest run packages/pipeline/test/rate-limit.test.ts`
Expected: 3 tests passent.

- [ ] **Step 5 : HTTP**

`packages/pipeline/src/lib/http.ts` :

```ts
export const USER_AGENT = 'NoviBot/0.1 (+https://github.com/novi; contact@simwego.com)';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} sur ${url}`);
  }
}

export type FetchOptions = {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'HEAD' | 'POST';
  body?: string;
  maxBytes?: number;
};

export async function fetchWithTimeout(url: string, opts: FetchOptions = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    return await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'user-agent': USER_AGENT, ...opts.headers },
      body: opts.body,
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<{ data: T; response: Response }> {
  const response = await fetchWithTimeout(url, { ...opts, headers: { accept: 'application/json', ...opts.headers } });
  if (!response.ok && response.status !== 206) throw new HttpError(response.status, url);
  if (response.status === 204) return { data: null as T, response };
  return { data: (await response.json()) as T, response };
}

export type TextPage = { url: string; status: number; headers: Record<string, string>; body: string; contentType: string };

/** GET d'une page texte/HTML, tronquée à maxBytes, en-têtes en minuscules. */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<TextPage> {
  const response = await fetchWithTimeout(url, opts);
  const contentType = response.headers.get('content-type') ?? '';
  const headers: Record<string, string> = {};
  response.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const max = opts.maxBytes ?? 2_000_000;
  const buffer = Buffer.from(await response.arrayBuffer());
  const body = buffer.subarray(0, max).toString('utf8');
  return { url: response.url || url, status: response.status, headers, body, contentType };
}
```

- [ ] **Step 6 : test du journal de run**

`packages/pipeline/test/run.test.ts` :

```ts
import { createDb, crawlRuns, migrateAndSeed } from '@novi/db';
import { describe, expect, it } from 'vitest';
import { withRun } from '../src/lib/run';

describe('withRun', () => {
  it('records stats and errors, and never throws for per-item errors', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    const result = await withRun(db, 'test', { limit: 2 }, async (ctx) => {
      ctx.stats.processed = 2;
      ctx.stats.created = 1;
      ctx.error('000000001', new Error('boom'));
    });
    expect(result.stats).toMatchObject({ processed: 2, created: 1, errors: 1 });
    const row = db.select().from(crawlRuns).get();
    expect(row?.command).toBe('test');
    expect(row?.args).toEqual({ limit: 2 });
    expect(row?.finishedAt).toBeTruthy();
    expect(row?.errors).toEqual([{ siren: '000000001', message: 'boom' }]);
    expect(result.runId).toBe(row?.id);
  });
  it('still closes the run when the step throws, then rethrows', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    await expect(
      withRun(db, 'test', {}, async () => {
        throw new Error('fatal');
      }),
    ).rejects.toThrow('fatal');
    const row = db.select().from(crawlRuns).get();
    expect(row?.finishedAt).toBeTruthy();
    expect(row?.errors).toEqual([{ message: 'fatal' }]);
  });
});
```

- [ ] **Step 7 : journal de run**

`packages/pipeline/src/lib/run.ts` :

```ts
import { type Db, type RunError, type RunStats, crawlRuns } from '@novi/db';
import { eq } from 'drizzle-orm';
import { log, warn } from './logger';

export type RunContext = {
  runId: number;
  stats: RunStats;
  errors: RunError[];
  error: (siren: string | undefined, err: unknown) => void;
};

export type RunResult = { runId: number; stats: RunStats; errors: RunError[] };

export function emptyStats(): RunStats {
  return { processed: 0, created: 0, updated: 0, errors: 0 };
}

export async function withRun(
  db: Db,
  command: string,
  args: Record<string, unknown>,
  step: (ctx: RunContext) => Promise<void>,
): Promise<RunResult> {
  const run = db.insert(crawlRuns).values({ command, args }).returning({ id: crawlRuns.id }).get();
  const stats = emptyStats();
  const errors: RunError[] = [];
  const ctx: RunContext = {
    runId: run.id,
    stats,
    errors,
    error: (siren, err) => {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(siren ? { siren, message } : { message });
      stats.errors = errors.length;
      warn(`${siren ?? '-'} : ${message}`);
    },
  };
  log(`▶ ${command} ${JSON.stringify(args)}`);
  try {
    await step(ctx);
  } catch (err) {
    ctx.error(undefined, err);
    throw err;
  } finally {
    stats.errors = errors.length;
    db.update(crawlRuns)
      .set({ finishedAt: new Date().toISOString(), stats, errors })
      .where(eq(crawlRuns.id, run.id))
      .run();
    log(`■ ${command} terminé : ${JSON.stringify(stats)}`);
  }
  return { runId: run.id, stats, errors };
}
```

Run: `pnpm vitest run packages/pipeline/test/run.test.ts`
Expected: 2 tests passent.

- [ ] **Step 8 : CLI avec commandes vides**

`packages/pipeline/src/cli.ts` (les commandes seront branchées tâche par tâche ; pour l'instant chacune affiche « non implémenté ») :

```ts
import { Command } from 'commander';
import { log } from './lib/logger';

export const program = new Command('pipeline').description('Pipeline de données Novi');

const notImplemented = (name: string) => async () => {
  log(`${name} : non implémenté`);
};

const ingest = program.command('ingest').description('Ingestion des sources');
ingest.command('sirene').option('-d, --departement <code>', 'département', '06').option('--limit <n>', 'nombre max', Number).action(notImplemented('ingest sirene'));
ingest.command('offres').option('-d, --departement <code>', 'département', '06').option('--limit <n>', 'nombre max', Number).action(notImplemented('ingest offres'));

program.command('match').command('offres').option('--force').action(notImplemented('match offres'));
program.command('discover').command('websites').option('--force').option('--limit <n>', 'nombre max', Number).option('--siren <siren>').action(notImplemented('discover websites'));
program.command('crawl').command('websites').option('--force').option('--limit <n>', 'nombre max', Number).option('--siren <siren>').action(notImplemented('crawl websites'));
program.command('enrich').command('github').option('--force').option('--limit <n>', 'nombre max', Number).option('--siren <siren>').action(notImplemented('enrich github'));
program.command('signals').action(notImplemented('signals'));
program.command('run').command('all').option('-d, --departement <code>', 'département', '06').action(notImplemented('run all'));

program.parseAsync(process.argv);
```

`packages/pipeline/src/index.ts` :

```ts
export * from './lib/http';
export * from './lib/rate-limit';
export * from './lib/run';
```

Run: `pnpm pipeline ingest sirene --departement 06`
Expected: `[hh:mm:ss] ingest sirene : non implémenté`.

- [ ] **Step 9 : commit**

```bash
git add packages/pipeline pnpm-lock.yaml
git commit -m "feat(pipeline): squelette CLI, journal des runs, limiteur de débit, helpers HTTP

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9 : pipeline — `ingest sirene`

**Files:**
- Create: `packages/pipeline/src/sources/recherche-entreprises.ts`, `packages/pipeline/src/steps/ingest-sirene.ts`
- Create: `packages/pipeline/test/fixtures/recherche-entreprises-page.json`
- Modify: `packages/pipeline/src/cli.ts`, `packages/pipeline/src/index.ts`
- Test: `packages/pipeline/test/recherche-entreprises.test.ts`, `packages/pipeline/test/ingest-sirene.test.ts`

- [ ] **Step 1 : enregistrer une fixture réelle**

Run (Git Bash) :

```bash
mkdir -p packages/pipeline/test/fixtures
curl -s "https://recherche-entreprises.api.gouv.fr/search?departement=06&activite_principale=62.01Z&tranche_effectif_salarie=12&etat_administratif=A&est_entrepreneur_individuel=false&per_page=3&page=1" -o packages/pipeline/test/fixtures/recherche-entreprises-page.json
node -e "const j=require('./packages/pipeline/test/fixtures/recherche-entreprises-page.json');console.log(j.total_results, j.results.length, j.results.map(r=>[r.siren, r.siege.departement, r.matching_etablissements.length]))"
```

Expected: trois résultats, et pour au moins l'un d'eux un `siege.departement` différent de `06` (les sièges hors département apparaissent grâce au filtre sur les établissements). Si les trois ont leur siège dans le 06, relancer avec `per_page=10` puis ne garder que les trois premiers plus un résultat au siège hors 06 en éditant le JSON (ne pas inventer de champs, copier un vrai résultat).

- [ ] **Step 2 : test du client et de la sélection d'établissement**

`packages/pipeline/test/recherche-entreprises.test.ts` :

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickLocalEstablishment, searchPageSchema, toCompanyRow } from '../src/sources/recherche-entreprises';

const page = searchPageSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/recherche-entreprises-page.json'), 'utf8')),
);

describe('searchPageSchema', () => {
  it('parses the real API payload', () => {
    expect(page.results.length).toBeGreaterThan(0);
    expect(page.total_results).toBeGreaterThan(0);
    expect(page.results[0]?.siren).toMatch(/^\d{9}$/);
  });
});

describe('pickLocalEstablishment', () => {
  it('prefers the head office when it is in the department', () => {
    const inZone = page.results.find((r) => r.siege.departement === '06');
    if (!inZone) return;
    const picked = pickLocalEstablishment(inZone, '06');
    expect(picked?.siret).toBe(inZone.siege.siret);
    expect(picked?.headquartersInZone).toBe(true);
  });
  it('falls back to a matching establishment when the head office is elsewhere', () => {
    const outside = page.results.find((r) => r.siege.departement !== '06');
    if (!outside) return;
    const picked = pickLocalEstablishment(outside, '06');
    expect(picked?.headquartersInZone).toBe(false);
    expect(picked?.siret.startsWith(outside.siren)).toBe(true);
    expect(picked?.latitude).toBeGreaterThan(43);
  });
  it('returns null when nothing is in the department', () => {
    const first = page.results[0];
    if (!first) throw new Error('fixture vide');
    expect(pickLocalEstablishment(first, '99')).toBeNull();
  });
});

describe('toCompanyRow', () => {
  it('maps a result to a companies row', () => {
    const first = page.results[0];
    if (!first) throw new Error('fixture vide');
    const row = toCompanyRow(first, '06', { '62.01Z': 'Programmation informatique' });
    expect(row).not.toBeNull();
    expect(row?.siren).toBe(first.siren);
    expect(row?.legalName).toBe(first.nom_raison_sociale);
    expect(row?.nafLabel).toBe('Programmation informatique');
    expect(typeof row?.latitude).toBe('number');
    expect(row?.tradeNames).toBeInstanceOf(Array);
  });
});
```

- [ ] **Step 3 : lancer, vérifier l'échec**

Run: `pnpm vitest run packages/pipeline/test/recherche-entreprises.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 4 : client de l'API**

`packages/pipeline/src/sources/recherche-entreprises.ts` :

```ts
import type { NewCompany } from '@novi/db';
import { z } from 'zod';
import { fetchJson } from '../lib/http';
import { createLimiter } from '../lib/rate-limit';

const BASE_URL = 'https://recherche-entreprises.api.gouv.fr/search';
export const PER_PAGE = 25;

const numberish = z.union([z.number(), z.string()]).transform((v) => (v === '' ? null : Number(v))).nullable();

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
    finances: z.record(z.string(), z.object({ ca: z.number().nullable(), resultat_net: z.number().nullable() })).nullable().optional(),
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
export async function* iterateSearch(params: { departement: string; nafCode: string; headcountRange: string }) {
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

function toLocal(e: z.infer<typeof establishmentSchema>, headquartersInZone: boolean): LocalEstablishment | null {
  if (e.latitude === null || e.longitude === null || Number.isNaN(e.latitude) || Number.isNaN(e.longitude)) return null;
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

export function toCompanyRow(result: SearchResult, departement: string, nafLabels: Record<string, string>): NewCompany | null {
  const local = pickLocalEstablishment(result, departement);
  if (!local) return null;
  const legalName = result.nom_raison_sociale ?? result.nom_complet;
  const tradeNames = [...new Set([result.siege.nom_commercial, ...local.tradeNames].filter((n): n is string => !!n))];
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
```

Run: `pnpm vitest run packages/pipeline/test/recherche-entreprises.test.ts`
Expected: tests verts. Si Zod rejette la fixture, lire le message : le champ fautif est nommé ; ajuster le schéma (les champs sont `nullable()` par défaut dans cette API).

- [ ] **Step 5 : test de l'étape**

`packages/pipeline/test/ingest-sirene.test.ts` :

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { companies, createDb, migrateAndSeed } from '@novi/db';
import { describe, expect, it } from 'vitest';
import { searchPageSchema } from '../src/sources/recherche-entreprises';
import { ingestSirene } from '../src/steps/ingest-sirene';

const page = searchPageSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/recherche-entreprises-page.json'), 'utf8')),
);

async function* fakeIterate() {
  for (const r of page.results) yield r;
}

describe('ingestSirene', () => {
  it('upserts companies from the iterator and is idempotent', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    const first = await ingestSirene(db, { departement: '06', iterate: () => fakeIterate() });
    const count = db.select().from(companies).all().length;
    expect(count).toBeGreaterThan(0);
    expect(first.stats.created).toBe(count);
    const second = await ingestSirene(db, { departement: '06', iterate: () => fakeIterate() });
    expect(second.stats.created).toBe(0);
    expect(second.stats.updated).toBe(count);
    expect(db.select().from(companies).all().length).toBe(count);
  });
  it('respects --limit', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    await ingestSirene(db, { departement: '06', limit: 1, iterate: () => fakeIterate() });
    expect(db.select().from(companies).all().length).toBe(1);
  });
});
```

- [ ] **Step 6 : étape**

`packages/pipeline/src/steps/ingest-sirene.ts` :

```ts
import { loadIngestConfig } from '@novi/core';
import { type Db, companies } from '@novi/db';
import { eq } from 'drizzle-orm';
import { log } from '../lib/logger';
import { type RunResult, withRun } from '../lib/run';
import { type SearchResult, iterateSearch, toCompanyRow } from '../sources/recherche-entreprises';

export type IngestSireneOptions = {
  departement: string;
  limit?: number;
  /** Injectable pour les tests : par défaut, parcourt toutes les combinaisons NAF × tranche. */
  iterate?: () => AsyncIterable<SearchResult>;
};

async function* iterateAll(departement: string, nafCodes: string[], headcountRanges: string[]) {
  for (const nafCode of nafCodes) {
    for (const headcountRange of headcountRanges) {
      log(`SIRENE ${departement} NAF ${nafCode} tranche ${headcountRange}`);
      yield* iterateSearch({ departement, nafCode, headcountRange });
    }
  }
}

export function ingestSirene(db: Db, opts: IngestSireneOptions): Promise<RunResult> {
  const config = loadIngestConfig();
  const iterate = opts.iterate ?? (() => iterateAll(opts.departement, config.nafCodes, config.headcountRanges));
  return withRun(db, 'ingest sirene', { departement: opts.departement, limit: opts.limit ?? null }, async (ctx) => {
    for await (const result of iterate()) {
      if (opts.limit !== undefined && ctx.stats.processed >= opts.limit) break;
      ctx.stats.processed += 1;
      try {
        const row = toCompanyRow(result, opts.departement, config.nafLabels);
        if (!row) {
          ctx.stats.skipped = (ctx.stats.skipped ?? 0) + 1;
          continue;
        }
        const exists = db.select({ siren: companies.siren }).from(companies).where(eq(companies.siren, row.siren)).get();
        if (exists) {
          const { siren: _siren, ...update } = row;
          db.update(companies).set(update).where(eq(companies.siren, row.siren)).run();
          ctx.stats.updated += 1;
        } else {
          db.insert(companies).values(row).run();
          ctx.stats.created += 1;
        }
      } catch (err) {
        ctx.error(result.siren, err);
      }
    }
  });
}
```

Run: `pnpm vitest run packages/pipeline/test/ingest-sirene.test.ts`
Expected: 2 tests passent.

- [ ] **Step 7 : brancher la CLI**

Dans `packages/pipeline/src/cli.ts`, remplacer l'action de `ingest sirene` :

```ts
import { getDb } from '@novi/db';
import { ingestSirene } from './steps/ingest-sirene';
// ...
ingest
  .command('sirene')
  .option('-d, --departement <code>', 'département', '06')
  .option('--limit <n>', 'nombre max', Number)
  .action(async (opts: { departement: string; limit?: number }) => {
    await ingestSirene(getDb(), opts);
  });
```

Ajouter dans `packages/pipeline/src/index.ts` : `export * from './steps/ingest-sirene';` et `export * from './sources/recherche-entreprises';`.

- [ ] **Step 8 : run réel, limité**

Run: `pnpm pipeline ingest sirene --departement 06 --limit 50`
Expected: logs `SIRENE 06 NAF 62.01Z tranche 03`, puis `■ ingest sirene terminé : {"processed":50,"created":<n>,...}`. Vérifier :

```bash
node -e "const D=require('better-sqlite3');const db=new D('data/novi.db');console.log(db.prepare('select count(*) c from companies').get(), db.prepare('select name, city, headquarters_in_zone from companies limit 5').all())"
```

Expected: des entreprises avec des villes du 06.

- [ ] **Step 9 : commit**

```bash
git add packages/pipeline
git commit -m "feat(pipeline): ingestion SIRENE via l'API Recherche d'entreprises

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10 : pipeline — `ingest offres` (France Travail)

**Files:**
- Create: `packages/pipeline/src/sources/france-travail.ts`, `packages/pipeline/src/steps/ingest-offres.ts`
- Create: `packages/pipeline/test/fixtures/france-travail-search.json`
- Modify: `packages/pipeline/src/cli.ts`, `packages/pipeline/src/index.ts`
- Test: `packages/pipeline/test/france-travail.test.ts`, `packages/pipeline/test/ingest-offres.test.ts`

Prérequis utilisateur : compte gratuit sur francetravail.io, application créée avec l'API « Offres d'emploi v2 » activée, identifiants copiés dans `.env` (`FRANCE_TRAVAIL_CLIENT_ID`, `FRANCE_TRAVAIL_CLIENT_SECRET`). Les tests n'en ont pas besoin.

- [ ] **Step 1 : fixture écrite à la main (structure réelle de l'API, données fictives)**

`packages/pipeline/test/fixtures/france-travail-search.json` :

```json
{
  "resultats": [
    {
      "id": "190ABCD",
      "intitule": "Développeur Full Stack React / Node.js (H/F)",
      "description": "Au sein d'une startup de 20 personnes à Sophia Antipolis, vous développez notre plateforme SaaS. Stack : React, TypeScript, Node.js, PostgreSQL, déployée sur AWS.",
      "dateCreation": "2026-09-01T08:12:00.000Z",
      "dateActualisation": "2026-09-20T09:00:00.000Z",
      "lieuTravail": { "libelle": "06 - VALBONNE", "latitude": 43.6197, "longitude": 7.0373, "codePostal": "06560", "commune": "06152" },
      "romeCode": "M1805",
      "romeLibelle": "Études et développement informatique",
      "entreprise": { "nom": "CLIKEN WEB", "description": "Éditeur de solutions web", "url": "https://www.cliken-web.com" },
      "typeContrat": "CDI",
      "typeContratLibelle": "Contrat à durée indéterminée",
      "experienceExige": "D",
      "origineOffre": { "origine": "1", "urlOrigine": "https://candidat.francetravail.fr/offres/recherche/detail/190ABCD" }
    },
    {
      "id": "190EFGH",
      "intitule": "Ingénieur DevOps (H/F)",
      "description": "Kubernetes, Terraform, GitLab CI. Poste à Nice.",
      "dateCreation": "2026-08-15T10:00:00.000Z",
      "lieuTravail": { "libelle": "06 - NICE", "latitude": 43.7102, "longitude": 7.262, "codePostal": "06000", "commune": "06088" },
      "romeCode": "M1810",
      "entreprise": { "nom": "EMPLOYEUR INCONNU SARL" },
      "typeContrat": "CDD",
      "origineOffre": { "origine": "2", "urlOrigine": "https://example.org/jobs/190EFGH", "partenaires": [{ "nom": "Partenaire", "url": "https://example.org/jobs/190EFGH" }] }
    },
    {
      "id": "190IJKL",
      "intitule": "Développeur Python confidentiel",
      "description": "Django et Postgres.",
      "dateCreation": "2026-07-02T10:00:00.000Z",
      "lieuTravail": { "libelle": "06 - ANTIBES", "codePostal": "06600" },
      "romeCode": "M1805",
      "typeContrat": "CDI"
    }
  ],
  "filtresPossibles": []
}
```

- [ ] **Step 2 : test du client**

`packages/pipeline/test/france-travail.test.ts` :

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { monthlyWindows, parseContentRange, searchResponseSchema, toOfferRow } from '../src/sources/france-travail';

const payload = searchResponseSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/france-travail-search.json'), 'utf8')),
);

describe('searchResponseSchema', () => {
  it('parses offers with optional employer and coordinates', () => {
    expect(payload.resultats).toHaveLength(3);
    expect(payload.resultats[2]?.entreprise).toBeUndefined();
    expect(payload.resultats[2]?.lieuTravail?.latitude).toBeUndefined();
  });
});

describe('parseContentRange', () => {
  it('reads first, last and total', () => {
    expect(parseContentRange('offres 0-149/1234')).toEqual({ first: 0, last: 149, total: 1234 });
    expect(parseContentRange(null)).toBeNull();
    expect(parseContentRange('offres 0-2/3')).toEqual({ first: 0, last: 2, total: 3 });
  });
});

describe('monthlyWindows', () => {
  it('produces 12 consecutive windows ending now', () => {
    const now = new Date('2026-09-29T12:00:00Z');
    const windows = monthlyWindows(now, 12);
    expect(windows).toHaveLength(12);
    expect(windows[0]?.max).toBe('2026-09-29T12:00:00Z');
    expect(windows[0]?.min).toBe('2026-08-29T12:00:00Z');
    expect(windows[11]?.min).toBe('2025-09-29T12:00:00Z');
    for (let i = 1; i < windows.length; i++) expect(windows[i]?.max).toBe(windows[i - 1]?.min);
  });
});

describe('toOfferRow', () => {
  it('maps fields and picks the origin URL', () => {
    const row = toOfferRow(payload.resultats[0]!, 7);
    expect(row).toMatchObject({
      id: '190ABCD',
      source: 'france_travail',
      employerName: 'CLIKEN WEB',
      title: 'Développeur Full Stack React / Node.js (H/F)',
      url: 'https://candidat.francetravail.fr/offres/recherche/detail/190ABCD',
      contractType: 'CDI',
      publishedAt: '2026-09-01T08:12:00.000Z',
      latitude: 43.6197,
      longitude: 7.0373,
      city: 'VALBONNE',
      isActive: true,
      lastSeenRunId: 7,
    });
  });
  it('handles missing employer and coordinates', () => {
    const row = toOfferRow(payload.resultats[2]!, 7);
    expect(row.employerName).toBeNull();
    expect(row.latitude).toBeNull();
    expect(row.city).toBe('ANTIBES');
  });
});
```

- [ ] **Step 3 : lancer, vérifier l'échec**

Run: `pnpm vitest run packages/pipeline/test/france-travail.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 4 : client**

`packages/pipeline/src/sources/france-travail.ts` :

```ts
import type { NewJobOffer } from '@novi/db';
import { z } from 'zod';
import { optionalEnv, requireEnv } from '../lib/env';
import { HttpError, fetchWithTimeout } from '../lib/http';
import { warn } from '../lib/logger';
import { createLimiter } from '../lib/rate-limit';

const TOKEN_URL = 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire';
const SEARCH_URL = 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';
export const PAGE_SIZE = 150;
export const MAX_INDEX = 1149;
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
        partenaires: z.array(z.object({ nom: z.string().optional(), url: z.string().optional() }).passthrough()).optional(),
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
  const windows: DateWindow[] = [];
  let max = new Date(now);
  for (let i = 0; i < months; i++) {
    const min = new Date(max);
    min.setUTCMonth(min.getUTCMonth() - 1);
    windows.push({ min: isoNoMillis(min), max: isoNoMillis(max) });
    max = min;
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
    throw new HttpError(response.status, TOKEN_URL, `Authentification France Travail refusée (${response.status}). Vérifier FRANCE_TRAVAIL_CLIENT_ID / SECRET et l'activation de l'API Offres d'emploi v2.`);
  }
  const json = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

const limiter = createLimiter(8);

export type SearchParams = { departement: string; romeCode: string; window: DateWindow; first: number };

export async function searchOffers(params: SearchParams): Promise<{ offers: Offer[]; range: ContentRange | null }> {
  const token = await getAccessToken();
  const url = new URL(SEARCH_URL);
  url.searchParams.set('departement', params.departement);
  url.searchParams.set('codeROME', params.romeCode);
  url.searchParams.set('minCreationDate', params.window.min);
  url.searchParams.set('maxCreationDate', params.window.max);
  const last = Math.min(params.first + PAGE_SIZE - 1, MAX_INDEX);
  url.searchParams.set('range', `${params.first}-${last}`);
  const response = await limiter(() =>
    fetchWithTimeout(url.toString(), { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, timeoutMs: 30_000 }),
  );
  if (response.status === 204) return { offers: [], range: null };
  if (response.status !== 200 && response.status !== 206) throw new HttpError(response.status, url.toString());
  const data = searchResponseSchema.parse(await response.json());
  return { offers: data.resultats, range: parseContentRange(response.headers.get('content-range')) };
}

/** Itère toutes les offres d'un département pour des codes ROME, sur 12 fenêtres mensuelles. */
export async function* iterateOffers(departement: string, romeCodes: string[], now = new Date()): AsyncGenerator<Offer> {
  for (const romeCode of romeCodes) {
    for (const window of monthlyWindows(now, 12)) {
      let first = 0;
      for (;;) {
        const { offers, range } = await searchOffers({ departement, romeCode, window, first });
        for (const o of offers) yield o;
        if (offers.length < PAGE_SIZE || !range) break;
        if (range.total > MAX_INDEX + 1 && first === 0) {
          warn(`France Travail ${romeCode} ${window.min}→${window.max} : ${range.total} offres, seules les ${MAX_INDEX + 1} premières seront lues`);
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
```

Run: `pnpm vitest run packages/pipeline/test/france-travail.test.ts`
Expected: tests verts.

- [ ] **Step 5 : test de l'étape**

`packages/pipeline/test/ingest-offres.test.ts` :

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { companies, companyTech, createDb, jobOffers, migrateAndSeed } from '@novi/db';
import { describe, expect, it } from 'vitest';
import { type Offer, searchResponseSchema } from '../src/sources/france-travail';
import { ingestOffres } from '../src/steps/ingest-offres';

const payload = searchResponseSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/france-travail-search.json'), 'utf8')),
);

function iterate(offers: Offer[]) {
  return async function* () {
    for (const o of offers) yield o;
  };
}

describe('ingestOffres', () => {
  it('upserts offers, detects techs for already-matched offers, expires unseen offers after 3 runs', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    db.insert(companies)
      .values({ siren: '852196609', name: 'Cliken Web', legalName: 'CLIKEN WEB PRO', nafCode: '62.01Z', siretLocal: '85219660900048', latitude: 43.6197, longitude: 7.0373 })
      .run();
    // L'offre 190ABCD est déjà rattachée (par un run précédent de match).
    await ingestOffres(db, { departement: '06', iterate: iterate(payload.resultats) });
    db.update(jobOffers).set({ siren: '852196609' }).run();

    await ingestOffres(db, { departement: '06', iterate: iterate(payload.resultats) });
    const techs = db.select().from(companyTech).all().map((t) => t.tagSlug).sort();
    expect(techs).toEqual(expect.arrayContaining(['react', 'typescript', 'nodejs', 'postgresql', 'aws']));

    // Trois runs sans l'offre 190IJKL : elle expire.
    const twoOnly = payload.resultats.slice(0, 2);
    await ingestOffres(db, { departement: '06', iterate: iterate(twoOnly) });
    await ingestOffres(db, { departement: '06', iterate: iterate(twoOnly) });
    expect(db.select().from(jobOffers).all().find((o) => o.id === '190IJKL')?.isActive).toBe(true);
    await ingestOffres(db, { departement: '06', iterate: iterate(twoOnly) });
    expect(db.select().from(jobOffers).all().find((o) => o.id === '190IJKL')?.isActive).toBe(false);
    expect(db.select().from(jobOffers).all().find((o) => o.id === '190ABCD')?.isActive).toBe(true);
  });
});
```

- [ ] **Step 6 : étape**

`packages/pipeline/src/steps/ingest-offres.ts` :

```ts
import { detectTechs, loadIngestConfig, loadTechTags } from '@novi/core';
import { type Db, crawlRuns, jobOffers, upsertCompanyTech } from '@novi/db';
import { and, desc, eq, lt } from 'drizzle-orm';
import { type RunResult, withRun } from '../lib/run';
import { type Offer, iterateOffers, toOfferRow } from '../sources/france-travail';

export type IngestOffresOptions = {
  departement: string;
  limit?: number;
  iterate?: () => AsyncIterable<Offer>;
};

const EXPIRE_AFTER_RUNS = 3;
export const OFFER_TECH_CONFIDENCE = 0.8;

export function offerText(offer: { title: string; description: string | null }): string {
  return `${offer.title}\n${offer.description ?? ''}`;
}

export function ingestOffres(db: Db, opts: IngestOffresOptions): Promise<RunResult> {
  const config = loadIngestConfig();
  const tags = loadTechTags();
  const iterate = opts.iterate ?? (() => iterateOffers(opts.departement, config.romeCodes));
  return withRun(db, 'ingest offres', { departement: opts.departement, limit: opts.limit ?? null }, async (ctx) => {
    const seen = new Set<string>();
    for await (const offer of iterate()) {
      if (opts.limit !== undefined && ctx.stats.processed >= opts.limit) break;
      if (seen.has(offer.id)) continue;
      seen.add(offer.id);
      ctx.stats.processed += 1;
      try {
        const row = toOfferRow(offer, ctx.runId);
        const existing = db.select({ id: jobOffers.id, siren: jobOffers.siren }).from(jobOffers).where(eq(jobOffers.id, row.id)).get();
        if (existing) {
          const { id: _id, ...update } = row;
          db.update(jobOffers).set(update).where(eq(jobOffers.id, row.id)).run();
          ctx.stats.updated += 1;
          if (existing.siren) {
            upsertCompanyTech(db, existing.siren, 'offre', detectTechs(offerText(row), tags, OFFER_TECH_CONFIDENCE));
          }
        } else {
          db.insert(jobOffers).values(row).run();
          ctx.stats.created += 1;
        }
      } catch (err) {
        ctx.error(undefined, err);
      }
    }
    // Expiration : offres non vues depuis EXPIRE_AFTER_RUNS runs d'ingestion d'offres.
    const previousRuns = db
      .select({ id: crawlRuns.id })
      .from(crawlRuns)
      .where(eq(crawlRuns.command, 'ingest offres'))
      .orderBy(desc(crawlRuns.id))
      .limit(EXPIRE_AFTER_RUNS)
      .all();
    if (previousRuns.length >= EXPIRE_AFTER_RUNS) {
      const threshold = previousRuns[previousRuns.length - 1]?.id ?? 0;
      const expired = db
        .update(jobOffers)
        .set({ isActive: false })
        .where(and(eq(jobOffers.isActive, true), lt(jobOffers.lastSeenRunId, threshold)))
        .run();
      ctx.stats.expired = expired.changes;
    }
  });
}
```

Run: `pnpm vitest run packages/pipeline/test/ingest-offres.test.ts`
Expected: le test passe. Le seuil : avec les runs d'ingestion d'offres d'identifiants r1 < r2 < r3 < r4 < r5, après r5 les trois derniers sont r3, r4, r5 et une offre vue pour la dernière fois en r2 (< r3) expire.

- [ ] **Step 7 : brancher la CLI et exporter**

Dans `packages/pipeline/src/cli.ts` :

```ts
import { ingestOffres } from './steps/ingest-offres';
// ...
ingest
  .command('offres')
  .option('-d, --departement <code>', 'département', '06')
  .option('--limit <n>', 'nombre max', Number)
  .action(async (opts: { departement: string; limit?: number }) => {
    await ingestOffres(getDb(), opts);
  });
```

Dans `packages/pipeline/src/index.ts` : `export * from './steps/ingest-offres';` et `export * from './sources/france-travail';`.

- [ ] **Step 8 : run réel si les identifiants sont là**

Run: `pnpm pipeline ingest offres --departement 06 --limit 200`
Expected: `■ ingest offres terminé : {"processed":200,"created":200,...}`. Sans identifiants : message `Variable d'environnement manquante : FRANCE_TRAVAIL_CLIENT_ID`, le run est journalisé avec l'erreur et la commande sort en erreur.

- [ ] **Step 9 : commit**

```bash
git add packages/pipeline
git commit -m "feat(pipeline): ingestion des offres France Travail avec fenêtres mensuelles et expiration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11 : pipeline — `match offres`

**Files:**
- Create: `packages/pipeline/src/steps/match-offres.ts`
- Modify: `packages/pipeline/src/cli.ts`, `packages/pipeline/src/index.ts`
- Test: `packages/pipeline/test/match-offres.test.ts`

- [ ] **Step 1 : tests**

`packages/pipeline/test/match-offres.test.ts` :

```ts
import { companies, companyTech, createDb, jobOffers, migrateAndSeed, saveAlias } from '@novi/db';
import { describe, expect, it } from 'vitest';
import { findCompanyForOffer, matchOffres } from '../src/steps/match-offres';

function setup() {
  const db = createDb(':memory:');
  migrateAndSeed(db);
  db.insert(companies)
    .values([
      { siren: '000000001', name: 'Cliken Web', legalName: 'CLIKEN WEB PRO', tradeNames: ['CLIKEN WEB'], nafCode: '62.01Z', siretLocal: '00000000100010', latitude: 43.6197, longitude: 7.0373 },
      { siren: '000000002', name: 'Nice Tech Studio', legalName: 'NICE TECH STUDIO', nafCode: '62.01Z', siretLocal: '00000000200010', latitude: 43.7102, longitude: 7.262 },
      { siren: '000000003', name: 'Studio Nice Tech', legalName: 'STUDIO NICE TECH', nafCode: '62.01Z', siretLocal: '00000000300010', latitude: 43.55, longitude: 7.01 },
    ])
    .run();
  return db;
}

describe('findCompanyForOffer', () => {
  it('matches on legal name ignoring legal form, within 15 km', () => {
    const db = setup();
    expect(findCompanyForOffer(db, { employerName: 'SAS CLIKEN WEB PRO', latitude: 43.62, longitude: 7.04 })).toBe('000000001');
  });
  it('matches on trade name', () => {
    const db = setup();
    expect(findCompanyForOffer(db, { employerName: 'Cliken Web', latitude: 43.62, longitude: 7.04 })).toBe('000000001');
  });
  it('rejects a name match that is too far away', () => {
    const db = setup();
    expect(findCompanyForOffer(db, { employerName: 'Cliken Web', latitude: 43.2965, longitude: 5.3698 })).toBeNull();
  });
  it('uses fuzzy matching above 0.9 and prefers the closest candidate', () => {
    const db = setup();
    expect(findCompanyForOffer(db, { employerName: 'NICE TECH STUDIOS', latitude: 43.71, longitude: 7.26 })).toBe('000000002');
  });
  it('returns null without coordinates unless the name is exact', () => {
    const db = setup();
    expect(findCompanyForOffer(db, { employerName: 'Cliken Web', latitude: null, longitude: null })).toBe('000000001');
    expect(findCompanyForOffer(db, { employerName: 'NICE TECH STUDIOS', latitude: null, longitude: null })).toBeNull();
  });
  it('aliases win', () => {
    const db = setup();
    saveAlias(db, 'Totally Different Name', '000000003');
    expect(findCompanyForOffer(db, { employerName: 'totally different name', latitude: null, longitude: null })).toBe('000000003');
  });
});

describe('matchOffres', () => {
  it('links offers and writes their techs', async () => {
    const db = setup();
    db.insert(jobOffers)
      .values([
        { id: 'A', title: 'Dev React', description: 'React et TypeScript.', employerName: 'CLIKEN WEB', latitude: 43.62, longitude: 7.04 },
        { id: 'B', title: 'Dev', description: 'Rien', employerName: 'INCONNU', latitude: 43.62, longitude: 7.04 },
      ])
      .run();
    const result = await matchOffres(db, {});
    expect(result.stats).toMatchObject({ processed: 2, matched: 1 });
    expect(db.select().from(jobOffers).all().find((o) => o.id === 'A')?.siren).toBe('000000001');
    expect(db.select().from(jobOffers).all().find((o) => o.id === 'B')?.siren).toBeNull();
    expect(db.select().from(companyTech).all().map((t) => t.tagSlug).sort()).toEqual(['react', 'typescript']);
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `pnpm vitest run packages/pipeline/test/match-offres.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : implémentation**

`packages/pipeline/src/steps/match-offres.ts` :

```ts
import { detectTechs, distanceKm, loadTechTags, normalizeCompanyName, trigramSimilarity } from '@novi/core';
import { type Db, companies, findAlias, jobOffers, upsertCompanyTech } from '@novi/db';
import { and, eq, isNull } from 'drizzle-orm';
import { type RunResult, withRun } from '../lib/run';
import { OFFER_TECH_CONFIDENCE, offerText } from './ingest-offres';

export const MAX_MATCH_DISTANCE_KM = 15;
export const FUZZY_THRESHOLD = 0.9;

type Candidate = { siren: string; names: string[]; latitude: number; longitude: number };

let cache: { db: Db; candidates: Candidate[] } | null = null;

function loadCandidates(db: Db): Candidate[] {
  if (cache && cache.db === db) return cache.candidates;
  const rows = db
    .select({ siren: companies.siren, legalName: companies.legalName, name: companies.name, tradeNames: companies.tradeNames, latitude: companies.latitude, longitude: companies.longitude })
    .from(companies)
    .all();
  const candidates = rows.map((r) => ({
    siren: r.siren,
    names: [...new Set([r.legalName, r.name, ...r.tradeNames].map(normalizeCompanyName).filter((n) => n.length > 0))],
    latitude: r.latitude,
    longitude: r.longitude,
  }));
  cache = { db, candidates };
  return candidates;
}

export function invalidateCandidates(): void {
  cache = null;
}

export type OfferLike = { employerName: string | null; latitude: number | null; longitude: number | null };

export function findCompanyForOffer(db: Db, offer: OfferLike): string | null {
  if (!offer.employerName) return null;
  const alias = findAlias(db, offer.employerName);
  if (alias) return alias;
  const wanted = normalizeCompanyName(offer.employerName);
  if (wanted.length === 0) return null;
  const hasPoint = offer.latitude !== null && offer.longitude !== null;
  const point = hasPoint ? { latitude: offer.latitude as number, longitude: offer.longitude as number } : null;

  const scored: { siren: string; exact: boolean; similarity: number; distance: number }[] = [];
  for (const c of loadCandidates(db)) {
    const exact = c.names.includes(wanted);
    const similarity = exact ? 1 : Math.max(...c.names.map((n) => trigramSimilarity(n, wanted)));
    if (!exact && similarity < FUZZY_THRESHOLD) continue;
    const distance = point ? distanceKm(point, c) : 0;
    if (point && distance > MAX_MATCH_DISTANCE_KM) continue;
    if (!point && !exact) continue;
    scored.push({ siren: c.siren, exact, similarity, distance });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => Number(b.exact) - Number(a.exact) || b.similarity - a.similarity || a.distance - b.distance);
  return scored[0]?.siren ?? null;
}

export type MatchOffresOptions = { force?: boolean };

export function matchOffres(db: Db, opts: MatchOffresOptions): Promise<RunResult> {
  const tags = loadTechTags();
  return withRun(db, 'match offres', { force: opts.force ?? false }, async (ctx) => {
    invalidateCandidates();
    const where = opts.force ? undefined : and(isNull(jobOffers.siren));
    const offers = db.select().from(jobOffers).where(where).all();
    ctx.stats.matched = 0;
    for (const offer of offers) {
      ctx.stats.processed += 1;
      try {
        const siren = findCompanyForOffer(db, offer);
        if (!siren) continue;
        db.update(jobOffers).set({ siren }).where(eq(jobOffers.id, offer.id)).run();
        upsertCompanyTech(db, siren, 'offre', detectTechs(offerText(offer), tags, OFFER_TECH_CONFIDENCE));
        ctx.stats.matched += 1;
        ctx.stats.updated += 1;
      } catch (err) {
        ctx.error(undefined, err);
      }
    }
  });
}
```

Run: `pnpm vitest run packages/pipeline/test/match-offres.test.ts`
Expected: tests verts. Si « NICE TECH STUDIOS » ne matche pas, vérifier la similarité : `trigramSimilarity('nice tech studio', 'nice tech studios')` vaut environ 0.91.

- [ ] **Step 4 : CLI et exports**

Dans `packages/pipeline/src/cli.ts` :

```ts
import { matchOffres } from './steps/match-offres';
// ...
program.command('match').command('offres').option('--force', 'retraiter aussi les offres déjà rattachées').action(async (opts: { force?: boolean }) => {
  await matchOffres(getDb(), opts);
});
```

Dans `packages/pipeline/src/index.ts` : `export * from './steps/match-offres';`.

Run: `pnpm pipeline match offres`
Expected: `■ match offres terminé : {"processed":N,"matched":M,...}`.

- [ ] **Step 5 : commit**

```bash
git add packages/pipeline
git commit -m "feat(pipeline): rattachement des offres aux entreprises par nom et proximité

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12 : pipeline — `discover websites`

**Files:**
- Create: `packages/pipeline/src/sources/overpass.ts`, `packages/pipeline/src/steps/discover-websites.ts`
- Create: `packages/pipeline/test/fixtures/overpass.json`, `packages/pipeline/test/fixtures/site-cliken.html`
- Modify: `packages/pipeline/src/cli.ts`, `packages/pipeline/src/index.ts`
- Test: `packages/pipeline/test/discover-websites.test.ts`

- [ ] **Step 1 : fixtures**

`packages/pipeline/test/fixtures/overpass.json` :

```json
{
  "version": 0.6,
  "elements": [
    { "type": "node", "id": 1, "lat": 43.6198, "lon": 7.0374, "tags": { "name": "Cliken Web", "office": "it", "website": "https://www.cliken-web.com" } },
    { "type": "way", "id": 2, "center": { "lat": 43.7103, "lon": 7.2621 }, "tags": { "name": "Nice Tech Studio", "office": "company", "website": "nicetechstudio.fr" } },
    { "type": "node", "id": 3, "lat": 43.55, "lon": 7.01, "tags": { "name": "Boulangerie", "shop": "bakery", "website": "https://boulangerie.example" } }
  ]
}
```

`packages/pipeline/test/fixtures/site-cliken.html` :

```html
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Cliken Web — Agence web à Sophia Antipolis</title>
  <meta name="description" content="Cliken Web conçoit des sites et applications web sur mesure.">
  <script src="/_next/static/chunks/main-abc123.js"></script>
</head>
<body>
  <div id="__next">
    <nav><a href="/">Accueil</a> <a href="/a-propos">À propos</a> <a href="/nous-rejoindre">Nous rejoindre</a></nav>
    <main>
      <h1>Nous construisons des plateformes SaaS</h1>
      <p>Notre stack : React, TypeScript et Node.js, avec PostgreSQL et un déploiement sur AWS.</p>
      <p>Nous sommes une ESN à taille humaine.</p>
      <a href="https://github.com/cliken-web">GitHub</a>
      <a href="https://www.linkedin.com/company/cliken-web/">LinkedIn</a>
    </main>
  </div>
</body>
</html>
```

- [ ] **Step 2 : tests**

`packages/pipeline/test/discover-websites.test.ts` :

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { companies, createDb, migrateAndSeed } from '@novi/db';
import { describe, expect, it } from 'vitest';
import { matchOsmBusiness, normalizeWebsite, parseOverpass } from '../src/sources/overpass';
import { candidateDomains, discoverWebsites, verifyHomepage } from '../src/steps/discover-websites';

const overpass = parseOverpass(JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/overpass.json'), 'utf8')));
const html = readFileSync(join(import.meta.dirname, 'fixtures/site-cliken.html'), 'utf8');

describe('overpass', () => {
  it('parses nodes and ways with centers', () => {
    expect(overpass).toHaveLength(3);
    expect(overpass[1]).toMatchObject({ name: 'Nice Tech Studio', latitude: 43.7103, longitude: 7.2621, website: 'https://nicetechstudio.fr' });
  });
  it('normalizes websites to https URLs', () => {
    expect(normalizeWebsite('nicetechstudio.fr')).toBe('https://nicetechstudio.fr');
    expect(normalizeWebsite('http://x.fr/')).toBe('http://x.fr/');
    expect(normalizeWebsite('')).toBeNull();
  });
  it('matches by name within 300 m', () => {
    const company = { name: 'Cliken Web', legalName: 'CLIKEN WEB PRO', tradeNames: ['CLIKEN WEB'], latitude: 43.6197, longitude: 7.0373 };
    expect(matchOsmBusiness(company, overpass)?.website).toBe('https://www.cliken-web.com');
    expect(matchOsmBusiness({ ...company, latitude: 43.9, longitude: 7.3 }, overpass)).toBeNull();
    expect(matchOsmBusiness({ ...company, name: 'Autre', legalName: 'AUTRE', tradeNames: [] }, overpass)).toBeNull();
  });
});

describe('candidateDomains', () => {
  it('slugifies trade names then legal name across TLDs', () => {
    const domains = candidateDomains({ name: 'Cliken Web', legalName: 'CLIKEN WEB PRO', tradeNames: ['CLIKEN WEB'] });
    expect(domains.slice(0, 5)).toEqual([
      'https://clikenweb.com',
      'https://clikenweb.fr',
      'https://clikenweb.io',
      'https://clikenweb.eu',
      'https://clikenweb.tech',
    ]);
    expect(domains).toContain('https://clikenwebpro.com');
    expect(new Set(domains).size).toBe(domains.length);
  });
});

describe('verifyHomepage', () => {
  it('accepts when a significant word of the name is in the title or description', () => {
    expect(verifyHomepage(html, { name: 'Cliken Web', legalName: 'CLIKEN WEB PRO', tradeNames: [] })).toBe(true);
    expect(verifyHomepage(html, { name: 'Boulangerie Dupont', legalName: 'DUPONT', tradeNames: [] })).toBe(false);
  });
});

describe('discoverWebsites', () => {
  it('uses offers first, then OSM, then domain guessing, and never overwrites manual', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    db.insert(companies)
      .values([
        { siren: '000000001', name: 'Cliken Web', legalName: 'CLIKEN WEB PRO', tradeNames: ['CLIKEN WEB'], nafCode: '62.01Z', siretLocal: 'a', latitude: 43.6197, longitude: 7.0373 },
        { siren: '000000002', name: 'Nice Tech Studio', legalName: 'NICE TECH STUDIO', nafCode: '62.01Z', siretLocal: 'b', latitude: 43.7102, longitude: 7.262 },
        { siren: '000000003', name: 'Guessable', legalName: 'GUESSABLE', nafCode: '62.01Z', siretLocal: 'c', latitude: 43.5, longitude: 7.0 },
        { siren: '000000004', name: 'Manual', legalName: 'MANUAL', nafCode: '62.01Z', siretLocal: 'd', latitude: 43.5, longitude: 7.0, website: 'https://manual.example', websiteSource: 'manuel', websiteConfidence: 1 },
      ])
      .run();
    const fetched: string[] = [];
    await discoverWebsites(db, {
      force: true,
      offerUrls: new Map([['000000001', 'https://www.cliken-web.com']]),
      osm: overpass,
      fetchHomepage: async (url) => {
        fetched.push(url);
        return url === 'https://guessable.com' ? '<title>Guessable — accueil</title>' : null;
      },
    });
    const rows = Object.fromEntries(db.select().from(companies).all().map((c) => [c.siren, c]));
    expect(rows['000000001']).toMatchObject({ website: 'https://www.cliken-web.com', websiteSource: 'offre', websiteConfidence: 0.9 });
    expect(rows['000000002']).toMatchObject({ website: 'https://nicetechstudio.fr', websiteSource: 'osm', websiteConfidence: 0.8 });
    expect(rows['000000003']).toMatchObject({ website: 'https://guessable.com', websiteSource: 'devinette', websiteConfidence: 0.6 });
    expect(rows['000000004']).toMatchObject({ website: 'https://manual.example', websiteSource: 'manuel' });
    expect(fetched).not.toContain('https://manual.com');
  });
});
```

- [ ] **Step 3 : lancer, vérifier l'échec**

Run: `pnpm vitest run packages/pipeline/test/discover-websites.test.ts`
Expected: FAIL, modules introuvables.

- [ ] **Step 4 : source Overpass**

`packages/pipeline/src/sources/overpass.ts` :

```ts
import { distanceKm, normalizeCompanyName, trigramSimilarity } from '@novi/core';
import { z } from 'zod';
import { fetchJson } from '../lib/http';

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

/** Une seule requête pour toute la zone : bureaux et artisans avec un site web. */
export async function fetchOsmBusinesses(bbox: BBox): Promise<OsmBusiness[]> {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const query = `[out:json][timeout:180];(nwr["website"]["name"]["office"](${b});nwr["website"]["name"]["craft"](${b}););out center tags;`;
  const { data } = await fetchJson<unknown>(OVERPASS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
    timeoutMs: 200_000,
  });
  return parseOverpass(data);
}

export type NamedCompany = { name: string; legalName: string; tradeNames: string[]; latitude: number; longitude: number };

const MAX_OSM_DISTANCE_KM = 0.3;
const OSM_SIMILARITY = 0.85;

export function matchOsmBusiness(company: NamedCompany, businesses: OsmBusiness[]): OsmBusiness | null {
  const names = [company.name, company.legalName, ...company.tradeNames].map(normalizeCompanyName).filter(Boolean);
  let best: { b: OsmBusiness; score: number } | null = null;
  for (const b of businesses) {
    if (distanceKm(company, b) > MAX_OSM_DISTANCE_KM) continue;
    const bn = normalizeCompanyName(b.name);
    const score = Math.max(...names.map((n) => (n === bn ? 1 : trigramSimilarity(n, bn))));
    if (score >= OSM_SIMILARITY && (!best || score > best.score)) best = { b, score };
  }
  return best?.b ?? null;
}
```

- [ ] **Step 5 : étape**

`packages/pipeline/src/steps/discover-websites.ts` :

```ts
import { significantWords, slugify, stripAccents } from '@novi/core';
import { type Db, companies, jobOffers } from '@novi/db';
import * as cheerio from 'cheerio';
import { and, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { fetchText } from '../lib/http';
import { log } from '../lib/logger';
import { createLimiter } from '../lib/rate-limit';
import { type RunResult, withRun } from '../lib/run';
import { type BBox, type OsmBusiness, fetchOsmBusinesses, matchOsmBusiness } from '../sources/overpass';

const TLDS = ['com', 'fr', 'io', 'eu', 'tech'];

export type NameFields = { name: string; legalName: string; tradeNames: string[] };

export function candidateDomains(c: NameFields): string[] {
  const bases = [...new Set([...c.tradeNames, c.name, c.legalName].map(slugify).filter((s) => s.length >= 3))];
  const out: string[] = [];
  for (const base of bases) for (const tld of TLDS) out.push(`https://${base}.${tld}`);
  return [...new Set(out)];
}

export function verifyHomepage(html: string, c: NameFields): boolean {
  const $ = cheerio.load(html);
  const text = stripAccents(`${$('title').text()} ${$('meta[name="description"]').attr('content') ?? ''} ${$('meta[property="og:title"]').attr('content') ?? ''}`).toLowerCase();
  const words = new Set([...c.tradeNames, c.name, c.legalName].flatMap(significantWords));
  const slugs = [...c.tradeNames, c.name].map(slugify).filter((s) => s.length >= 4);
  return [...words].some((w) => text.includes(w)) || slugs.some((s) => text.replace(/\s+/g, '').includes(s));
}

const guessLimiter = createLimiter(4);

async function defaultFetchHomepage(url: string): Promise<string | null> {
  try {
    const page = await guessLimiter(() => fetchText(url, { timeoutMs: 8_000, maxBytes: 300_000 }));
    if (page.status >= 400 || !page.contentType.includes('html')) return null;
    return page.body;
  } catch {
    return null;
  }
}

export function offerWebsiteMap(db: Db): Map<string, string> {
  const rows = db
    .select({ siren: jobOffers.siren, raw: jobOffers.raw })
    .from(jobOffers)
    .where(isNotNull(jobOffers.siren))
    .all();
  const map = new Map<string, string>();
  for (const r of rows) {
    const url = (r.raw as { entreprise?: { url?: string } } | null)?.entreprise?.url;
    if (r.siren && url && !map.has(r.siren)) map.set(r.siren, url);
  }
  return map;
}

export function bboxOf(rows: { latitude: number; longitude: number }[]): BBox | null {
  if (rows.length === 0) return null;
  const lats = rows.map((r) => r.latitude);
  const lons = rows.map((r) => r.longitude);
  const margin = 0.01;
  return { south: Math.min(...lats) - margin, west: Math.min(...lons) - margin, north: Math.max(...lats) + margin, east: Math.max(...lons) + margin };
}

export type DiscoverOptions = {
  force?: boolean;
  limit?: number;
  siren?: string;
  offerUrls?: Map<string, string>;
  osm?: OsmBusiness[];
  fetchHomepage?: (url: string) => Promise<string | null>;
};

export function discoverWebsites(db: Db, opts: DiscoverOptions): Promise<RunResult> {
  const fetchHomepage = opts.fetchHomepage ?? defaultFetchHomepage;
  return withRun(db, 'discover websites', { force: opts.force ?? false, limit: opts.limit ?? null, siren: opts.siren ?? null }, async (ctx) => {
    const notManual = or(isNull(companies.websiteSource), eq(companies.websiteSource, 'offre'), eq(companies.websiteSource, 'osm'), eq(companies.websiteSource, 'devinette'));
    const where = opts.siren
      ? and(eq(companies.siren, opts.siren), notManual)
      : opts.force
        ? notManual
        : and(isNull(companies.website), notManual);
    let targets = db.select().from(companies).where(where).all();
    if (opts.limit !== undefined) targets = targets.slice(0, opts.limit);
    log(`${targets.length} entreprises à traiter`);

    const offerUrls = opts.offerUrls ?? offerWebsiteMap(db);
    let osm = opts.osm ?? null;
    if (!osm) {
      const bbox = bboxOf(targets);
      osm = bbox ? await fetchOsmBusinesses(bbox) : [];
      log(`OpenStreetMap : ${osm.length} bureaux avec site web dans la zone`);
    }
    ctx.stats.fromOffers = 0;
    ctx.stats.fromOsm = 0;
    ctx.stats.fromGuess = 0;

    for (const c of targets) {
      ctx.stats.processed += 1;
      try {
        let found: { website: string; source: 'offre' | 'osm' | 'devinette'; confidence: number } | null = null;
        const fromOffer = offerUrls.get(c.siren);
        if (fromOffer) found = { website: fromOffer, source: 'offre', confidence: 0.9 };
        if (!found) {
          const b = matchOsmBusiness(c, osm);
          if (b) found = { website: b.website, source: 'osm', confidence: 0.8 };
        }
        if (!found) {
          for (const url of candidateDomains(c)) {
            const html = await fetchHomepage(url);
            if (html && verifyHomepage(html, c)) {
              found = { website: url, source: 'devinette', confidence: 0.6 };
              break;
            }
          }
        }
        if (!found) continue;
        db.update(companies)
          .set({ website: found.website, websiteSource: found.source, websiteConfidence: found.confidence })
          .where(eq(companies.siren, c.siren))
          .run();
        ctx.stats.updated += 1;
        if (found.source === 'offre') ctx.stats.fromOffers += 1;
        else if (found.source === 'osm') ctx.stats.fromOsm += 1;
        else ctx.stats.fromGuess += 1;
      } catch (err) {
        ctx.error(c.siren, err);
      }
    }
  });
}
```

Run: `pnpm vitest run packages/pipeline/test/discover-websites.test.ts`
Expected: tests verts. Pour « Guessable », `candidateDomains` commence par `https://guessable.com` et le faux `fetchHomepage` renvoie un titre contenant « guessable » (mot significatif de 9 lettres).

- [ ] **Step 6 : CLI, exports, run réel**

Dans `packages/pipeline/src/cli.ts` :

```ts
import { discoverWebsites } from './steps/discover-websites';
// ...
program
  .command('discover')
  .command('websites')
  .option('--force', 'retraiter les sites déjà trouvés automatiquement')
  .option('--limit <n>', 'nombre max', Number)
  .option('--siren <siren>', 'une seule entreprise')
  .action(async (opts: { force?: boolean; limit?: number; siren?: string }) => {
    await discoverWebsites(getDb(), opts);
  });
```

Dans `packages/pipeline/src/index.ts` : `export * from './steps/discover-websites';` et `export * from './sources/overpass';`.

Run: `pnpm pipeline discover websites --limit 30`
Expected: log OpenStreetMap avec un nombre de bureaux, puis `■ discover websites terminé : {"processed":30,...,"fromOffers":a,"fromOsm":b,"fromGuess":c}`. Vérifier quelques sites trouvés :

```bash
node -e "const D=require('better-sqlite3');const db=new D('data/novi.db');console.log(db.prepare('select name, website, website_source from companies where website is not null limit 10').all())"
```

- [ ] **Step 7 : commit**

```bash
git add packages/pipeline
git commit -m "feat(pipeline): découverte des sites web via offres, OpenStreetMap et devinette de domaine

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13 : pipeline — `crawl websites`

**Files:**
- Create: `packages/pipeline/src/steps/crawl-websites.ts`
- Modify: `packages/pipeline/src/cli.ts`, `packages/pipeline/src/index.ts`
- Test: `packages/pipeline/test/crawl-websites.test.ts`

- [ ] **Step 1 : tests**

`packages/pipeline/test/crawl-websites.test.ts` :

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { companies, companyTech, createDb, migrateAndSeed, signals } from '@novi/db';
import { describe, expect, it } from 'vitest';
import type { TextPage } from '../src/lib/http';
import { analyzeSite, crawlCompany, crawlWebsites, extractLinks, selectPages, visibleText } from '../src/steps/crawl-websites';

const html = readFileSync(join(import.meta.dirname, 'fixtures/site-cliken.html'), 'utf8');
const base = 'https://www.cliken-web.com';

function page(url: string, body: string, headers: Record<string, string> = {}): TextPage {
  return { url, status: 200, headers: { 'content-type': 'text/html', ...headers }, body, contentType: 'text/html' };
}

describe('visibleText', () => {
  it('drops scripts and collapses whitespace', () => {
    const text = visibleText('<html><body><script>var x</script><p>Bonjour   le</p><p>monde.</p></body></html>');
    expect(text).toBe('Bonjour le\nmonde.');
  });
});

describe('extractLinks', () => {
  it('returns absolute internal links and external github/linkedin links', () => {
    const links = extractLinks(html, base);
    expect(links.internal).toContain('https://www.cliken-web.com/a-propos');
    expect(links.internal).toContain('https://www.cliken-web.com/nous-rejoindre');
    expect(links.github).toBe('cliken-web');
    expect(links.linkedin).toBe('https://www.linkedin.com/company/cliken-web/');
  });
});

describe('selectPages', () => {
  it('combines config paths, career-like links, capped at 12, homepage first', () => {
    const pages = selectPages(base, ['https://www.cliken-web.com/nous-rejoindre', 'https://www.cliken-web.com/blog/post-1', 'https://www.cliken-web.com/contact'], [
      { href: 'https://www.cliken-web.com/nous-rejoindre', text: 'Nous rejoindre' },
      { href: 'https://www.cliken-web.com/contact', text: 'Contact' },
    ]);
    expect(pages[0]).toBe(base);
    expect(pages).toContain('https://www.cliken-web.com/nous-rejoindre');
    expect(pages).toContain('https://www.cliken-web.com/carrieres');
    expect(pages).not.toContain('https://www.cliken-web.com/contact');
    expect(pages.length).toBeLessThanOrEqual(12);
  });
});

describe('analyzeSite', () => {
  it('extracts description, careers, github, linkedin, techs with sources, and ESN', () => {
    const result = analyzeSite(base, [page(base, html, { server: 'cloudflare' }), page(`${base}/nous-rejoindre`, '<html><body><h1>Rejoignez-nous</h1><p>Nous cherchons un développeur Rust backend.</p></body></html>')]);
    expect(result.description).toBe('Cliken Web conçoit des sites et applications web sur mesure.');
    expect(result.careersUrl).toBe(`${base}/nous-rejoindre`);
    expect(result.githubOrg).toBe('cliken-web');
    expect(result.linkedinUrl).toBe('https://www.linkedin.com/company/cliken-web/');
    const bySlug = Object.fromEntries(result.detections.map((d) => [d.slug, d]));
    expect(bySlug.nextjs?.confidence).toBe(0.9);
    expect(bySlug.cloudflare?.confidence).toBe(0.9);
    expect(bySlug.react?.confidence).toBe(0.5);
    expect(bySlug.rust?.confidence).toBe(0.7);
    expect(result.esnEvidence).toBe('Nous sommes une ESN à taille humaine.');
  });
});

describe('crawlCompany / crawlWebsites', () => {
  it('persists the analysis and replaces previous site detections', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    db.insert(companies)
      .values({ siren: '000000001', name: 'Cliken Web', legalName: 'CLIKEN WEB PRO', nafCode: '62.01Z', siretLocal: 'a', latitude: 43.62, longitude: 7.04, website: base, websiteSource: 'manuel', websiteConfidence: 1 })
      .run();
    const fetchPage = async (url: string) => (url === base ? page(base, html) : null);
    await crawlCompany(db, '000000001', { fetchPage, robotsAllowed: async () => true });
    let techs = db.select().from(companyTech).all();
    expect(techs.map((t) => t.tagSlug)).toContain('nextjs');
    expect(techs.every((t) => t.source === 'site')).toBe(true);
    expect(db.select().from(signals).all().map((s) => s.kind)).toEqual(['esn_suspected']);
    const row = db.select().from(companies).get();
    expect(row?.githubOrg).toBe('cliken-web');
    expect(row?.lastCrawledAt).toBeTruthy();

    const fetchPage2 = async (url: string) => (url === base ? page(base, '<html><head><title>Cliken</title></head><body><p>Nous utilisons Vue.</p></body></html>') : null);
    const result = await crawlWebsites(db, { force: true, fetchPage: fetchPage2, robotsAllowed: async () => true });
    expect(result.stats.processed).toBe(1);
    techs = db.select().from(companyTech).all();
    expect(techs.map((t) => t.tagSlug)).toEqual(['vue']);
    expect(db.select().from(signals).all()).toEqual([]);
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `pnpm vitest run packages/pipeline/test/crawl-websites.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : implémentation**

`packages/pipeline/src/steps/crawl-websites.ts` :

```ts
import { type Detection, detectEsn, detectFingerprints, detectTechs, loadCrawlPaths, loadEsnKeywords, loadTechTags, mergeDetections } from '@novi/core';
import { type Db, companies, replaceCompanyTech, replaceSignals } from '@novi/db';
import * as cheerio from 'cheerio';
import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import pLimit from 'p-limit';
import robotsParser from 'robots-parser';
import { type TextPage, USER_AGENT, fetchText } from '../lib/http';
import { log } from '../lib/logger';
import { sleep } from '../lib/rate-limit';
import { type RunResult, withRun } from '../lib/run';

export const MAX_PAGES = 12;
const RECRAWL_AFTER_DAYS = 30;
const CAREER_WORDS = ['carri', 'career', 'recrut', 'job', 'rejoin', 'join'];
const TECH_PAGE_WORDS = [...CAREER_WORDS, 'tech', 'stack', 'engineering', 'equipe', 'team', 'about', 'propos'];

export function visibleText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, template').remove();
  const blocks: string[] = [];
  $('body')
    .find('p, h1, h2, h3, h4, h5, h6, li, td, th, dd, dt, blockquote, figcaption, span, a, div')
    .each((_, el) => {
      const own = $(el).clone().children().remove().end().text().replace(/\s+/g, ' ').trim();
      if (own) blocks.push(own);
    });
  if (blocks.length === 0) return $('body').text().replace(/\s+/g, ' ').trim();
  return blocks.join('\n');
}

export type Link = { href: string; text: string };
export type Links = { internal: string[]; anchors: Link[]; github: string | null; linkedin: string | null };

const PERSONAL_GITHUB = new Set(['features', 'topics', 'sponsors', 'about', 'pricing', 'login', 'join', 'marketplace', 'explore']);

export function extractLinks(html: string, baseUrl: string): Links {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const internal = new Set<string>();
  const anchors: Link[] = [];
  let github: string | null = null;
  let linkedin: string | null = null;
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    url.hash = '';
    if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
      const org = url.pathname.split('/').filter(Boolean)[0];
      if (org && !PERSONAL_GITHUB.has(org.toLowerCase()) && !github) github = org;
      return;
    }
    if (url.hostname.endsWith('linkedin.com') && url.pathname.includes('/company/') && !linkedin) {
      linkedin = url.toString();
      return;
    }
    if (url.hostname === base.hostname) {
      const clean = url.toString().replace(/\/$/, '');
      internal.add(clean);
      anchors.push({ href: clean, text: $(el).text().replace(/\s+/g, ' ').trim() });
    }
  });
  return { internal: [...internal], anchors, github, linkedin };
}

function looksLikeCareer(text: string, href: string): boolean {
  const hay = `${text} ${href}`.toLowerCase();
  return CAREER_WORDS.some((w) => hay.includes(w));
}

export function selectPages(baseUrl: string, internal: string[], anchors: Link[]): string[] {
  const root = baseUrl.replace(/\/$/, '');
  const ordered: string[] = [root];
  const push = (u: string) => {
    if (!ordered.includes(u) && ordered.length < MAX_PAGES) ordered.push(u);
  };
  for (const a of anchors) if (looksLikeCareer(a.text, a.href)) push(a.href);
  for (const path of loadCrawlPaths()) {
    const candidate = `${root}${path}`;
    if (internal.includes(candidate)) push(candidate);
  }
  for (const path of loadCrawlPaths()) push(`${root}${path}`);
  return ordered.slice(0, MAX_PAGES);
}

export type SiteAnalysis = {
  description: string | null;
  careersUrl: string | null;
  githubOrg: string | null;
  linkedinUrl: string | null;
  detections: Detection[];
  esnEvidence: string | null;
};

export function analyzeSite(baseUrl: string, pages: TextPage[]): SiteAnalysis {
  const tags = loadTechTags();
  const esnKeywords = loadEsnKeywords();
  const home = pages.find((p) => p.url.replace(/\/$/, '') === baseUrl.replace(/\/$/, '')) ?? pages[0];
  let description: string | null = null;
  let careersUrl: string | null = null;
  let githubOrg: string | null = null;
  let linkedinUrl: string | null = null;
  let esnEvidence: string | null = null;
  const lists: Detection[][] = [];

  if (home) {
    const $ = cheerio.load(home.body);
    description = $('meta[name="description"]').attr('content')?.trim() || $('meta[property="og:description"]').attr('content')?.trim() || null;
  }
  for (const p of pages) {
    const links = extractLinks(p.body, baseUrl);
    githubOrg = githubOrg ?? links.github;
    linkedinUrl = linkedinUrl ?? links.linkedin;
    const isCareer = looksLikeCareer('', p.url) && p.url.replace(/\/$/, '') !== baseUrl.replace(/\/$/, '');
    if (isCareer && !careersUrl) careersUrl = p.url;
    if (!careersUrl) {
      const careerLink = links.anchors.find((a) => looksLikeCareer(a.text, a.href));
      if (careerLink) careersUrl = careerLink.href;
    }
    const text = visibleText(p.body);
    const technical = TECH_PAGE_WORDS.some((w) => p.url.toLowerCase().includes(w));
    lists.push(detectTechs(text, tags, technical ? 0.7 : 0.5));
    lists.push(detectFingerprints(p.body, p.headers, tags));
    esnEvidence = esnEvidence ?? detectEsn(text, esnKeywords);
  }
  return { description, careersUrl, githubOrg, linkedinUrl, detections: mergeDetections(...lists), esnEvidence };
}

export type CrawlDeps = {
  fetchPage?: (url: string) => Promise<TextPage | null>;
  robotsAllowed?: (url: string) => Promise<boolean>;
};

async function defaultFetchPage(url: string): Promise<TextPage | null> {
  try {
    const page = await fetchText(url, { timeoutMs: 10_000, maxBytes: 2_000_000 });
    if (page.status >= 400 || !page.contentType.includes('html')) return null;
    return page;
  } catch {
    return null;
  }
}

const robotsCache = new Map<string, ReturnType<typeof robotsParser> | null>();

async function defaultRobotsAllowed(url: string): Promise<boolean> {
  const origin = new URL(url).origin;
  if (!robotsCache.has(origin)) {
    try {
      const page = await fetchText(`${origin}/robots.txt`, { timeoutMs: 8_000, maxBytes: 100_000 });
      robotsCache.set(origin, page.status === 200 ? robotsParser(`${origin}/robots.txt`, page.body) : null);
    } catch {
      robotsCache.set(origin, null);
    }
  }
  const robots = robotsCache.get(origin);
  return robots ? (robots.isAllowed(url, USER_AGENT) ?? true) : true;
}

/** Crawl et analyse d'une seule entreprise. Utilisé par la CLI et par l'app (bouton « Analyser le site »). */
export async function crawlCompany(db: Db, siren: string, deps: CrawlDeps = {}): Promise<SiteAnalysis> {
  const fetchPage = deps.fetchPage ?? defaultFetchPage;
  const robotsAllowed = deps.robotsAllowed ?? defaultRobotsAllowed;
  const company = db.select().from(companies).where(eq(companies.siren, siren)).get();
  if (!company) throw new Error(`Entreprise inconnue : ${siren}`);
  if (!company.website) throw new Error(`Pas de site web pour ${company.name}`);
  const baseUrl = company.website.replace(/\/$/, '');
  if (!(await robotsAllowed(baseUrl))) throw new Error(`robots.txt interdit le crawl de ${baseUrl}`);
  const home = await fetchPage(baseUrl);
  if (!home) throw new Error(`Page d'accueil inaccessible : ${baseUrl}`);
  const pages: TextPage[] = [home];
  const links = extractLinks(home.body, baseUrl);
  for (const url of selectPages(baseUrl, links.internal, links.anchors).slice(1)) {
    if (deps.fetchPage === undefined) await sleep(1000);
    if (!(await robotsAllowed(url))) continue;
    const p = await fetchPage(url);
    if (p) pages.push(p);
  }
  const analysis = analyzeSite(baseUrl, pages);
  db.update(companies)
    .set({
      description: analysis.description,
      careersUrl: analysis.careersUrl,
      githubOrg: analysis.githubOrg ?? company.githubOrg,
      linkedinUrl: analysis.linkedinUrl ?? company.linkedinUrl,
      lastCrawledAt: new Date().toISOString(),
    })
    .where(eq(companies.siren, siren))
    .run();
  replaceCompanyTech(db, siren, 'site', analysis.detections);
  replaceSignals(db, siren, ['esn_suspected'], analysis.esnEvidence ? [{ kind: 'esn_suspected', value: null, evidence: analysis.esnEvidence }] : []);
  return analysis;
}

export type CrawlOptions = CrawlDeps & { force?: boolean; limit?: number; siren?: string; concurrency?: number };

export function crawlWebsites(db: Db, opts: CrawlOptions): Promise<RunResult> {
  return withRun(db, 'crawl websites', { force: opts.force ?? false, limit: opts.limit ?? null, siren: opts.siren ?? null }, async (ctx) => {
    const cutoff = new Date(Date.now() - RECRAWL_AFTER_DAYS * 86_400_000).toISOString();
    const where = opts.siren
      ? eq(companies.siren, opts.siren)
      : opts.force
        ? isNotNull(companies.website)
        : and(isNotNull(companies.website), or(isNull(companies.lastCrawledAt), lt(companies.lastCrawledAt, cutoff)));
    let targets = db.select({ siren: companies.siren, name: companies.name }).from(companies).where(where).all();
    if (opts.limit !== undefined) targets = targets.slice(0, opts.limit);
    log(`${targets.length} sites à analyser`);
    const limit = pLimit(opts.concurrency ?? 5);
    await Promise.all(
      targets.map((t) =>
        limit(async () => {
          ctx.stats.processed += 1;
          try {
            const a = await crawlCompany(db, t.siren, opts);
            ctx.stats.updated += 1;
            log(`${t.name} : ${a.detections.length} technos${a.careersUrl ? ', page carrière' : ''}${a.esnEvidence ? ', ESN ?' : ''}`);
          } catch (err) {
            ctx.error(t.siren, err);
          }
        }),
      ),
    );
  });
}
```

Run: `pnpm vitest run packages/pipeline/test/crawl-websites.test.ts`
Expected: tests verts. Points de vigilance :
- `visibleText` de la fixture doit contenir la phrase « Notre stack : React, TypeScript et Node.js, avec PostgreSQL et un déploiement sur AWS. » pour que `react` soit détecté à 0.5 sur la page d'accueil.
- `rust` à 0.7 vient de la page `/nous-rejoindre` (URL contenant « rejoin »).
- Si `robots-parser` pose un problème de typage en import par défaut, utiliser `import robotsParser = require('robots-parser')` n'est pas possible en ESM ; préférer `import robotsParser from 'robots-parser';` avec `esModuleInterop` (déjà activé).

- [ ] **Step 4 : CLI, exports, run réel**

Dans `packages/pipeline/src/cli.ts` :

```ts
import { crawlWebsites } from './steps/crawl-websites';
// ...
program
  .command('crawl')
  .command('websites')
  .option('--force', 'réanalyser même si crawlé il y a moins de 30 jours')
  .option('--limit <n>', 'nombre max', Number)
  .option('--siren <siren>', 'une seule entreprise')
  .action(async (opts: { force?: boolean; limit?: number; siren?: string }) => {
    await crawlWebsites(getDb(), opts);
  });
```

Dans `packages/pipeline/src/index.ts` : `export * from './steps/crawl-websites';`.

Run: `pnpm pipeline crawl websites --limit 10`
Expected: une ligne par site (`Nom : N technos, page carrière`), puis `■ crawl websites terminé`. Les sites injoignables apparaissent en `⚠` et n'arrêtent pas le run.

- [ ] **Step 5 : commit**

```bash
git add packages/pipeline
git commit -m "feat(pipeline): crawl des sites web, extraction de la stack, page carrière, GitHub, LinkedIn et signal ESN

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14 : pipeline — `enrich github`

**Files:**
- Create: `packages/pipeline/src/sources/github.ts`, `packages/pipeline/src/steps/enrich-github.ts`
- Create: `packages/pipeline/test/fixtures/github-repos.json`
- Modify: `packages/pipeline/src/cli.ts`, `packages/pipeline/src/index.ts`
- Test: `packages/pipeline/test/enrich-github.test.ts`

- [ ] **Step 1 : fixture (structure réelle de `GET /orgs/{org}/repos`, réduite)**

`packages/pipeline/test/fixtures/github-repos.json` :

```json
[
  { "id": 1, "name": "platform", "full_name": "cliken-web/platform", "private": false, "fork": false, "language": "TypeScript", "pushed_at": "2026-09-10T10:00:00Z", "stargazers_count": 12, "archived": false },
  { "id": 2, "name": "api", "full_name": "cliken-web/api", "private": false, "fork": false, "language": "Go", "pushed_at": "2026-08-01T10:00:00Z", "stargazers_count": 3, "archived": false },
  { "id": 3, "name": "old-site", "full_name": "cliken-web/old-site", "private": false, "fork": false, "language": "PHP", "pushed_at": "2021-01-01T10:00:00Z", "stargazers_count": 0, "archived": true },
  { "id": 4, "name": "forked-lib", "full_name": "cliken-web/forked-lib", "private": false, "fork": true, "language": "Rust", "pushed_at": "2026-09-01T10:00:00Z", "stargazers_count": 0, "archived": false },
  { "id": 5, "name": "docs", "full_name": "cliken-web/docs", "private": false, "fork": false, "language": null, "pushed_at": "2026-09-01T10:00:00Z", "stargazers_count": 0, "archived": false }
]
```

- [ ] **Step 2 : tests**

`packages/pipeline/test/enrich-github.test.ts` :

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTechTags } from '@novi/core';
import { companies, companyTech, createDb, migrateAndSeed, signals } from '@novi/db';
import { describe, expect, it } from 'vitest';
import { languageToSlug, reposSchema, summarizeRepos } from '../src/sources/github';
import { enrichGithub } from '../src/steps/enrich-github';

const repos = reposSchema.parse(JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/github-repos.json'), 'utf8')));
const tags = loadTechTags();
const NOW = new Date('2026-09-29T00:00:00Z');

describe('languageToSlug', () => {
  it('maps GitHub language names to tag slugs', () => {
    expect(languageToSlug('TypeScript', tags)).toBe('typescript');
    expect(languageToSlug('Go', tags)).toBe('go');
    expect(languageToSlug('C#', tags)).toBe('csharp');
    expect(languageToSlug('Jupyter Notebook', tags)).toBeNull();
  });
});

describe('summarizeRepos', () => {
  it('ignores forks and archived repos, counts languages, finds last push', () => {
    const s = summarizeRepos(repos, tags, NOW);
    expect(s.detections.map((d) => d.slug).sort()).toEqual(['go', 'typescript']);
    expect(s.detections.find((d) => d.slug === 'typescript')?.evidence).toBe('1 dépôt public : platform');
    expect(s.lastPushAt).toBe('2026-09-10T10:00:00Z');
    expect(s.active).toBe(true);
    expect(s.publicRepos).toBe(3);
  });
  it('is inactive when the last push is older than 6 months', () => {
    const s = summarizeRepos(repos, tags, new Date('2027-06-01T00:00:00Z'));
    expect(s.active).toBe(false);
  });
});

describe('enrichGithub', () => {
  it('writes github detections and the github_active signal', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    db.insert(companies)
      .values({ siren: '000000001', name: 'Cliken Web', legalName: 'CLIKEN WEB PRO', nafCode: '62.01Z', siretLocal: 'a', latitude: 43.62, longitude: 7.04, githubOrg: 'cliken-web' })
      .run();
    const result = await enrichGithub(db, { fetchRepos: async () => repos, now: NOW });
    expect(result.stats).toMatchObject({ processed: 1, updated: 1 });
    const techs = db.select().from(companyTech).all();
    expect(techs.map((t) => `${t.source}:${t.tagSlug}:${t.confidence}`).sort()).toEqual(['github:go:0.8', 'github:typescript:0.8']);
    expect(db.select().from(signals).all()).toMatchObject([{ kind: 'github_active', value: 3 }]);
  });
});
```

- [ ] **Step 3 : lancer, vérifier l'échec**

Run: `pnpm vitest run packages/pipeline/test/enrich-github.test.ts`
Expected: FAIL, modules introuvables.

- [ ] **Step 4 : source GitHub**

`packages/pipeline/src/sources/github.ts` :

```ts
import type { Detection, TechTag } from '@novi/core';
import { z } from 'zod';
import { optionalEnv } from '../lib/env';
import { HttpError, fetchJson } from '../lib/http';
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
        const { data } = await limiter(() => fetchJson<unknown>(url, { headers: headers(), timeoutMs: 20_000 }));
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

export type RepoSummary = { detections: Detection[]; lastPushAt: string | null; active: boolean; publicRepos: number };

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
  const active = !!lastPushAt && now.getTime() - new Date(lastPushAt).getTime() < ACTIVE_WITHIN_DAYS * 86_400_000;
  return { detections, lastPushAt, active, publicRepos: own.length };
}
```

- [ ] **Step 5 : étape**

`packages/pipeline/src/steps/enrich-github.ts` :

```ts
import { loadTechTags } from '@novi/core';
import { type Db, companies, replaceCompanyTech, replaceSignals } from '@novi/db';
import { eq, isNotNull } from 'drizzle-orm';
import { log } from '../lib/logger';
import { type RunResult, withRun } from '../lib/run';
import { type Repo, fetchRepos, summarizeRepos } from '../sources/github';

export type EnrichGithubOptions = {
  limit?: number;
  siren?: string;
  fetchRepos?: (org: string) => Promise<Repo[]>;
  now?: Date;
};

export function enrichGithub(db: Db, opts: EnrichGithubOptions): Promise<RunResult> {
  const tags = loadTechTags();
  const fetcher = opts.fetchRepos ?? fetchRepos;
  return withRun(db, 'enrich github', { limit: opts.limit ?? null, siren: opts.siren ?? null }, async (ctx) => {
    const where = opts.siren ? eq(companies.siren, opts.siren) : isNotNull(companies.githubOrg);
    let targets = db.select({ siren: companies.siren, name: companies.name, githubOrg: companies.githubOrg }).from(companies).where(where).all();
    if (opts.limit !== undefined) targets = targets.slice(0, opts.limit);
    log(`${targets.length} organisations GitHub à lire`);
    for (const t of targets) {
      if (!t.githubOrg) continue;
      ctx.stats.processed += 1;
      try {
        const summary = summarizeRepos(await fetcher(t.githubOrg), tags, opts.now);
        replaceCompanyTech(db, t.siren, 'github', summary.detections);
        replaceSignals(
          db,
          t.siren,
          ['github_active'],
          summary.active ? [{ kind: 'github_active', value: summary.publicRepos, evidence: `Dernier push le ${summary.lastPushAt?.slice(0, 10)}` }] : [],
        );
        ctx.stats.updated += 1;
        log(`${t.name} (${t.githubOrg}) : ${summary.publicRepos} dépôts, ${summary.detections.length} langages${summary.active ? ', actif' : ''}`);
      } catch (err) {
        ctx.error(t.siren, err);
      }
    }
  });
}
```

Run: `pnpm vitest run packages/pipeline/test/enrich-github.test.ts`
Expected: tests verts.

- [ ] **Step 6 : CLI, exports, run réel**

Dans `packages/pipeline/src/cli.ts` :

```ts
import { enrichGithub } from './steps/enrich-github';
// ...
program
  .command('enrich')
  .command('github')
  .option('--limit <n>', 'nombre max', Number)
  .option('--siren <siren>', 'une seule entreprise')
  .action(async (opts: { limit?: number; siren?: string }) => {
    await enrichGithub(getDb(), opts);
  });
```

Dans `packages/pipeline/src/index.ts` : `export * from './steps/enrich-github';` et `export * from './sources/github';`.

Run: `pnpm pipeline enrich github --limit 5`
Expected: une ligne par organisation lue. Sans `GITHUB_TOKEN`, la limite est de 60 requêtes par heure : au-delà, une erreur `HTTP 403` est journalisée par entreprise.

- [ ] **Step 7 : commit**

```bash
git add packages/pipeline
git commit -m "feat(pipeline): enrichissement par les dépôts GitHub publics

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15 : pipeline — `signals`

**Files:**
- Create: `packages/pipeline/src/steps/signals.ts`
- Modify: `packages/pipeline/src/cli.ts`, `packages/pipeline/src/index.ts`
- Test: `packages/pipeline/test/signals.test.ts`

- [ ] **Step 1 : tests**

`packages/pipeline/test/signals.test.ts` :

```ts
import { companies, createDb, jobOffers, migrateAndSeed, replaceSignals, signals } from '@novi/db';
import { describe, expect, it } from 'vitest';
import { computeSignals, revenueGrowth } from '../src/steps/signals';

describe('revenueGrowth', () => {
  it('compares the two most recent years with revenue', () => {
    expect(revenueGrowth({ '2022': { ca: 100, resultat_net: 1 }, '2023': { ca: 120, resultat_net: 2 } })).toEqual({ percent: 20, years: ['2022', '2023'] });
    expect(revenueGrowth({ '2021': { ca: 100, resultat_net: 1 }, '2023': { ca: 50, resultat_net: null } })).toEqual({ percent: -50, years: ['2021', '2023'] });
    expect(revenueGrowth({ '2023': { ca: 50, resultat_net: null } })).toBeNull();
    expect(revenueGrowth({ '2022': { ca: 0, resultat_net: null }, '2023': { ca: 50, resultat_net: null } })).toBeNull();
    expect(revenueGrowth(null)).toBeNull();
  });
});

describe('computeSignals', () => {
  it('derives recruiting, hiring history, careers page and revenue growth, keeping other signals', async () => {
    const db = createDb(':memory:');
    migrateAndSeed(db);
    const now = new Date('2026-09-29T00:00:00Z');
    db.insert(companies)
      .values({
        siren: '000000001', name: 'A', legalName: 'A', nafCode: '62.01Z', siretLocal: 'a', latitude: 43.7, longitude: 7.2,
        careersUrl: 'https://a.example/jobs',
        finances: { '2022': { ca: 100, resultat_net: 1 }, '2023': { ca: 130, resultat_net: 2 } },
      })
      .run();
    db.insert(jobOffers)
      .values([
        { id: '1', title: 'x', siren: '000000001', publishedAt: '2026-09-01T00:00:00Z', isActive: true },
        { id: '2', title: 'y', siren: '000000001', publishedAt: '2026-02-01T00:00:00Z', isActive: false },
        { id: '3', title: 'z', siren: '000000001', publishedAt: '2024-01-01T00:00:00Z', isActive: false },
      ])
      .run();
    replaceSignals(db, '000000001', ['esn_suspected'], [{ kind: 'esn_suspected', value: null, evidence: 'régie' }]);

    const result = await computeSignals(db, { now });
    expect(result.stats.processed).toBe(1);
    const rows = db.select().from(signals).all().map((s) => [s.kind, s.value]).sort();
    expect(rows).toEqual([
      ['careers_page_found', 1],
      ['esn_suspected', null],
      ['hired_last_12_months', 2],
      ['recruiting_now', 1],
      ['revenue_growth', 30],
    ]);
    await computeSignals(db, { now });
    expect(db.select().from(signals).all()).toHaveLength(5);
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `pnpm vitest run packages/pipeline/test/signals.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : implémentation**

`packages/pipeline/src/steps/signals.ts` :

```ts
import { type Db, type Finances, type SignalKind, companies, jobOffers, replaceSignals } from '@novi/db';
import { eq } from 'drizzle-orm';
import { type RunResult, withRun } from '../lib/run';

const DERIVED: SignalKind[] = ['recruiting_now', 'hired_last_12_months', 'careers_page_found', 'revenue_growth'];

export function revenueGrowth(finances: Finances | null | undefined): { percent: number; years: [string, string] } | null {
  if (!finances) return null;
  const years = Object.entries(finances)
    .filter(([, v]) => typeof v.ca === 'number' && v.ca !== null)
    .map(([y, v]) => [y, v.ca as number] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (years.length < 2) return null;
  const [prevYear, prev] = years[years.length - 2]!;
  const [lastYear, last] = years[years.length - 1]!;
  if (prev <= 0) return null;
  return { percent: Math.round(((last - prev) / prev) * 100), years: [prevYear, lastYear] };
}

export type SignalsOptions = { now?: Date };

export function computeSignals(db: Db, opts: SignalsOptions = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString();
  return withRun(db, 'signals', {}, async (ctx) => {
    const all = db.select({ siren: companies.siren, careersUrl: companies.careersUrl, finances: companies.finances }).from(companies).all();
    for (const c of all) {
      ctx.stats.processed += 1;
      try {
        const offers = db
          .select({ isActive: jobOffers.isActive, publishedAt: jobOffers.publishedAt })
          .from(jobOffers)
          .where(eq(jobOffers.siren, c.siren))
          .all();
        const active = offers.filter((o) => o.isActive).length;
        const lastYear = offers.filter((o) => o.publishedAt && o.publishedAt >= oneYearAgo).length;
        const rows: { kind: SignalKind; value: number | null; evidence: string | null }[] = [];
        if (active > 0) rows.push({ kind: 'recruiting_now', value: active, evidence: `${active} offre${active > 1 ? 's' : ''} active${active > 1 ? 's' : ''}` });
        if (lastYear > 0) rows.push({ kind: 'hired_last_12_months', value: lastYear, evidence: `${lastYear} offre${lastYear > 1 ? 's' : ''} sur 12 mois` });
        if (c.careersUrl) rows.push({ kind: 'careers_page_found', value: 1, evidence: c.careersUrl });
        const growth = revenueGrowth(c.finances);
        if (growth) rows.push({ kind: 'revenue_growth', value: growth.percent, evidence: `CA ${growth.years[0]} → ${growth.years[1]} : ${growth.percent > 0 ? '+' : ''}${growth.percent} %` });
        replaceSignals(db, c.siren, DERIVED, rows);
        ctx.stats.updated += 1;
      } catch (err) {
        ctx.error(c.siren, err);
      }
    }
  });
}
```

Run: `pnpm vitest run packages/pipeline/test/signals.test.ts`
Expected: tests verts.

- [ ] **Step 4 : CLI, exports**

Dans `packages/pipeline/src/cli.ts` :

```ts
import { computeSignals } from './steps/signals';
// ...
program.command('signals').description('Recalcule les signaux dérivés').action(async () => {
  await computeSignals(getDb());
});
```

Dans `packages/pipeline/src/index.ts` : `export * from './steps/signals';`.

Run: `pnpm pipeline signals`
Expected: `■ signals terminé : {"processed":N,"updated":N,...}`.

- [ ] **Step 5 : commit**

```bash
git add packages/pipeline
git commit -m "feat(pipeline): calcul des signaux dérivés

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16 : pipeline — `run all`, géocodage, exports, README

**Files:**
- Create: `packages/pipeline/src/sources/adresse.ts`, `packages/pipeline/src/steps/run-all.ts`
- Modify: `packages/pipeline/src/cli.ts`, `packages/pipeline/src/index.ts`, `README.md`
- Test: `packages/pipeline/test/adresse.test.ts`

- [ ] **Step 1 : test du géocodage (parsing seulement)**

`packages/pipeline/test/adresse.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { parseGeocode } from '../src/sources/adresse';

describe('parseGeocode', () => {
  it('returns the best feature as a point with a label', () => {
    const payload = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [7.262, 43.7102] }, properties: { label: 'Nice', score: 0.9, city: 'Nice', postcode: '06000' } },
      ],
    };
    expect(parseGeocode(payload)).toEqual({ label: 'Nice', latitude: 43.7102, longitude: 7.262 });
    expect(parseGeocode({ type: 'FeatureCollection', features: [] })).toBeNull();
  });
});
```

- [ ] **Step 2 : source API Adresse**

`packages/pipeline/src/sources/adresse.ts` :

```ts
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
```

Run: `pnpm vitest run packages/pipeline/test/adresse.test.ts`
Expected: test vert.

- [ ] **Step 3 : `run all`**

`packages/pipeline/src/steps/run-all.ts` :

```ts
import type { Db } from '@novi/db';
import { log, warn } from '../lib/logger';
import { hasCredentials } from '../sources/france-travail';
import { crawlWebsites } from './crawl-websites';
import { discoverWebsites } from './discover-websites';
import { enrichGithub } from './enrich-github';
import { ingestOffres } from './ingest-offres';
import { ingestSirene } from './ingest-sirene';
import { matchOffres } from './match-offres';
import { computeSignals } from './signals';

export async function runAll(db: Db, opts: { departement: string }): Promise<void> {
  await ingestSirene(db, { departement: opts.departement });
  if (hasCredentials()) {
    await ingestOffres(db, { departement: opts.departement });
    await matchOffres(db, {});
  } else {
    warn('Identifiants France Travail absents : étapes offres et match ignorées');
  }
  await discoverWebsites(db, {});
  await crawlWebsites(db, {});
  await enrichGithub(db, {});
  await computeSignals(db);
  log('Pipeline complet terminé');
}
```

Dans `packages/pipeline/src/cli.ts` :

```ts
import { runAll } from './steps/run-all';
// ...
program
  .command('run')
  .command('all')
  .option('-d, --departement <code>', 'département', '06')
  .action(async (opts: { departement: string }) => {
    await runAll(getDb(), opts);
  });
```

À ce stade, `cli.ts` ne contient plus aucun `notImplemented` : supprimer la fonction.

Dans `packages/pipeline/src/index.ts`, l'état final :

```ts
export * from './lib/http';
export * from './lib/rate-limit';
export * from './lib/run';
export * from './sources/adresse';
export * from './sources/france-travail';
export * from './sources/github';
export * from './sources/overpass';
export * from './sources/recherche-entreprises';
export * from './steps/crawl-websites';
export * from './steps/discover-websites';
export * from './steps/enrich-github';
export * from './steps/ingest-offres';
export * from './steps/ingest-sirene';
export * from './steps/match-offres';
export * from './steps/run-all';
export * from './steps/signals';
```

- [ ] **Step 4 : README**

`README.md` :

```markdown
# Novi

Découverte de startups et PME tech autour de chez soi. Le concept est dans `Concept.md`, le design dans `docs/superpowers/specs/`.

## Prérequis

- Node 22 ou plus récent, pnpm 9.
- Un compte développeur gratuit sur https://francetravail.io avec l'API « Offres d'emploi v2 » activée (facultatif : sans lui, les étapes offres sont ignorées).
- Un token GitHub personnel sans permission particulière (facultatif : passe de 60 à 5000 requêtes par heure).

## Mise en route

```bash
cp .env.example .env      # puis renseigner les identifiants
pnpm install
pnpm db:migrate           # crée data/novi.db, charge le dictionnaire des technos et le profil par défaut
pnpm pipeline run all --departement 06
```

## Commandes du pipeline

| Commande | Rôle |
|---|---|
| `pnpm pipeline ingest sirene -d 06` | Entreprises tech du département via l'API Recherche d'entreprises |
| `pnpm pipeline ingest offres -d 06` | Offres France Travail des 12 derniers mois |
| `pnpm pipeline match offres` | Rattache les offres aux entreprises (`--force` pour tout refaire) |
| `pnpm pipeline discover websites` | Trouve les sites web (offres, OpenStreetMap, devinette de domaine) |
| `pnpm pipeline crawl websites` | Analyse les sites : description, page carrière, GitHub, LinkedIn, stack |
| `pnpm pipeline enrich github` | Langages des dépôts publics |
| `pnpm pipeline signals` | Recalcule les signaux dérivés |
| `pnpm pipeline run all -d 06` | Enchaîne tout |

Options communes : `--limit N`, `--force`, `--siren X`. Chaque run est journalisé dans la table `crawl_runs`.

## Développement

```bash
pnpm test         # Vitest, sans réseau
pnpm lint         # Biome
pnpm typecheck
pnpm db:generate  # après modification de packages/db/src/schema.ts
```

## Structure

- `packages/core` : fonctions pures (normalisation, détection de technos, scoring) et configuration JSON.
- `packages/db` : schéma Drizzle, client SQLite, migrations. Le calcul de rayon est isolé dans `src/geo.ts` en vue de PostGIS.
- `packages/pipeline` : ligne de commande d'ingestion.
- `apps/web` : application Next.js (Plan 2).
```

- [ ] **Step 5 : vérification complète**

Run: `pnpm lint:fix && pnpm typecheck && pnpm test`
Expected: Biome sans erreur, `tsc` sans erreur dans les trois paquets, tous les tests verts.

Run: `pnpm pipeline run all --departement 06`
Expected: les sept étapes s'enchaînent (ou cinq sans identifiants France Travail). Durée indicative : SIRENE quelques minutes, découverte et crawl des sites de 30 minutes à une heure selon le nombre d'entreprises. Vérifier ensuite :

```bash
node -e "const D=require('better-sqlite3');const db=new D('data/novi.db');for(const t of ['companies','job_offers','company_tech','signals','crawl_runs'])console.log(t, db.prepare('select count(*) c from '+t).get().c)"
```

Expected: plusieurs centaines d'entreprises, des technos et des signaux.

- [ ] **Step 6 : commit**

```bash
git add -A
git commit -m "feat(pipeline): run all, géocodage API Adresse, README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Couverture du spec

| Section du spec | Tâches |
|---|---|
| 2 Architecture, module géographique | 1, 7 |
| 3 Modèle de données | 7 |
| 4.1 ingest sirene | 9 |
| 4.2 ingest offres | 10 |
| 4.3 match offres | 11 |
| 4.4 discover websites | 12 |
| 4.5 crawl websites | 13 |
| 4.6 enrich github | 14 |
| 4.7 signals | 15 |
| 4.8 run all | 16 |
| 5 Dictionnaire des technos | 4, 5 |
| 6 Scoring | 6 |
| 7 Application web | Plan 2 |
| 8 Gestion des erreurs (pipeline) | 8 (withRun), 10 (auth France Travail) |
| 9 Tests | chaque tâche |
| 10 Mise en route | 1, 16 |
