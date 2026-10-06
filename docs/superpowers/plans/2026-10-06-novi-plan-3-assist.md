# Novi V2 — Plan 3 : paquet `assist`, base, score, pipeline `refresh`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fournir tout ce dont l'app web aura besoin pour le CV, les lettres anonymisées et les nouvelles offres : un paquet `@novi/assist` (PDF, anonymisation réversible, adaptateurs LLM, prompt), la migration de base, le bonus de score pour les offres récentes, la commande `pipeline refresh` et sa planification Windows.

**Architecture:** Nouveau paquet `packages/assist` sans accès base ni réseau sauf dans les adaptateurs LLM (injection de `fetch` pour les tests). La base gagne deux tables (`cover_letters`, `offer_views`) et des colonnes de profil via une migration Drizzle. `@novi/core` reste pur : la récence d'une offre devient un paramètre du score. Le pipeline gagne une étape `refresh` qui enchaîne offres, rattachement et signaux, planifiée par un script PowerShell.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Zod, Drizzle 0.45 + better-sqlite3, `unpdf` 1.8 (pdf.js pour Node), `@anthropic-ai/sdk` 0.131 (optionnel, import dynamique), commander, PowerShell 7.

**Spec :** `docs/superpowers/specs/2026-10-06-novi-v2-assist-design.md`. Lis-la une fois avant de commencer.

**Branche :** `plan-3-assist` créée depuis `master`. Les commits utilisent l'identité git globale et se terminent par `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

**Conventions du dépôt :**
- Fichiers en LF (`.gitattributes`), lint `pnpm lint` (Biome, 7 avertissements pré-existants `noNonNullAssertion` tolérés, 0 erreur), `pnpm typecheck`, `pnpm test` (Vitest, sans réseau).
- Messages d'erreur et libellés en français.
- Ne jamais lancer `pnpm pipeline` ou toucher `data/novi.db` : les tests utilisent `createDb(':memory:')`.
- Dans un paquet, lancer un test ciblé : `pnpm --filter @novi/<paquet> exec vitest run test/<fichier>.test.ts`.

---

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `packages/assist/package.json`, `tsconfig.json`, `src/index.ts` | Paquet `@novi/assist` |
| `packages/assist/src/errors.ts` | `AssistError`, `LlmError` avec codes et messages français |
| `packages/assist/src/privacy.ts` | `anonymize`, `restore`, `Identity`, jetons |
| `packages/assist/src/cv.ts` | `analyzeCv`, `detectIdentityHints` |
| `packages/assist/src/pdf.ts` | `extractPdfText` via `unpdf` |
| `packages/assist/src/llm/types.ts` | `TextGenerator`, `GenerateInput`, `GenerateResult` |
| `packages/assist/src/llm/openai-compatible.ts` | Adaptateur `fetch` compatible OpenAI |
| `packages/assist/src/llm/anthropic.ts` | Adaptateur SDK Anthropic (import dynamique) |
| `packages/assist/src/llm/index.ts` | `createGenerator(env)`, `describeGenerator(env)` |
| `packages/assist/src/letter.ts` | `buildLetterPrompt` |
| `packages/assist/test/*.test.ts` | Tests unitaires du paquet |
| `packages/db/src/schema.ts`, `drizzle/0002_*.sql`, `src/queries.ts` | Colonnes profil, `cover_letters`, `offer_views`, requêtes associées |
| `packages/core/src/types.ts`, `src/score.ts` | `publishedAt` sur les offres du score, `newOfferDays`, `isRecentOffer` |
| `packages/pipeline/src/steps/refresh.ts`, `src/cli.ts`, `src/index.ts` | Commande `refresh` |
| `scripts/install-refresh-task.ps1`, `scripts/uninstall-refresh-task.ps1` | Planification Windows |
| `.env.example`, `README.md` | Documentation |

---

### Task 0 : Branche de travail

- [ ] **Step 1 : Créer la branche**

```bash
cd C:/Users/tomba/Downloads/Novi
git checkout master
git checkout -b plan-3-assist
```

Expected: `Switched to a new branch 'plan-3-assist'`.

---

### Task 1 : Squelette du paquet `@novi/assist` et erreurs typées

**Files:**
- Create: `packages/assist/package.json`
- Create: `packages/assist/tsconfig.json`
- Create: `packages/assist/src/errors.ts`
- Create: `packages/assist/src/index.ts`
- Test: `packages/assist/test/errors.test.ts`

- [ ] **Step 1 : Créer `packages/assist/package.json`**

```json
{
  "name": "@novi/assist",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.131.0",
    "@novi/core": "workspace:*",
    "unpdf": "^1.8.1"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^5.0.2"
  }
}
```

- [ ] **Step 2 : Créer `packages/assist/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

- [ ] **Step 3 : Installer les dépendances**

Run: `pnpm install`
Expected: se termine sans erreur ; `packages/assist/node_modules/unpdf` et `@anthropic-ai/sdk` existent. `better-sqlite3` n'est pas recompilé (déjà dans `neverBuiltDependencies`).

- [ ] **Step 4 : Écrire le test des erreurs**

`packages/assist/test/errors.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { AssistError, LlmError } from '../src/errors';

describe('AssistError', () => {
  it('carries a code and a French message', () => {
    const err = new AssistError('cv_no_text');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('cv_no_text');
    expect(err.message).toMatch(/aucun texte/i);
  });
  it('accepts a custom message', () => {
    expect(new AssistError('llm_misconfigured', 'Variable LLM_API_KEY manquante').message).toBe(
      'Variable LLM_API_KEY manquante',
    );
  });
});

describe('LlmError', () => {
  it('exposes retryAfterSeconds for rate limits', () => {
    const err = new LlmError('rate_limited', { retryAfterSeconds: 30 });
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterSeconds).toBe(30);
    expect(err.message).toContain('30 secondes');
  });
  it('has a default message per code', () => {
    expect(new LlmError('unauthorized').message).toMatch(/clé/i);
    expect(new LlmError('timeout').message).toMatch(/délai/i);
    expect(new LlmError('refused').message).toMatch(/refusé/i);
  });
});
```

- [ ] **Step 5 : Lancer le test, vérifier l'échec**

Run: `pnpm --filter @novi/assist exec vitest run test/errors.test.ts`
Expected: FAIL, `Cannot find module '../src/errors'`.

- [ ] **Step 6 : Écrire `packages/assist/src/errors.ts`**

```ts
export type AssistErrorCode = 'cv_not_pdf' | 'cv_too_large' | 'cv_no_text' | 'llm_misconfigured';

const ASSIST_MESSAGES: Record<AssistErrorCode, string> = {
  cv_not_pdf: "Ce fichier n'est pas un PDF",
  cv_too_large: 'Le CV dépasse la limite (5 Mo ou 10 pages)',
  cv_no_text: 'Aucun texte trouvé : le PDF semble être une image',
  llm_misconfigured: 'Fournisseur LLM mal configuré (voir .env.example)',
};

export class AssistError extends Error {
  readonly code: AssistErrorCode;
  constructor(code: AssistErrorCode, message?: string) {
    super(message ?? ASSIST_MESSAGES[code]);
    this.name = 'AssistError';
    this.code = code;
  }
}

export type LlmErrorCode = 'unauthorized' | 'rate_limited' | 'timeout' | 'bad_response' | 'refused' | 'http';

function llmMessage(code: LlmErrorCode, retryAfterSeconds?: number, status?: number): string {
  switch (code) {
    case 'unauthorized':
      return 'Clé LLM refusée (401/403) : vérifier LLM_API_KEY';
    case 'rate_limited':
      return retryAfterSeconds
        ? `Quota du fournisseur LLM atteint : réessayez dans ${retryAfterSeconds} secondes`
        : 'Quota du fournisseur LLM atteint : réessayez dans quelques minutes';
    case 'timeout':
      return 'Délai dépassé (60 s) en attendant le fournisseur LLM';
    case 'bad_response':
      return 'Réponse inattendue du fournisseur LLM';
    case 'refused':
      return 'Le modèle a refusé de répondre à cette demande';
    case 'http':
      return `Erreur HTTP ${status ?? ''} du fournisseur LLM`.trim();
  }
}

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly retryAfterSeconds?: number;
  readonly status?: number;
  constructor(code: LlmErrorCode, opts: { retryAfterSeconds?: number; status?: number; message?: string } = {}) {
    super(opts.message ?? llmMessage(code, opts.retryAfterSeconds, opts.status));
    this.name = 'LlmError';
    this.code = code;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.status = opts.status;
  }
}
```

- [ ] **Step 7 : Créer `packages/assist/src/index.ts`**

```ts
export * from './errors';
```

(Les autres exports sont ajoutés tâche par tâche.)

- [ ] **Step 8 : Lancer le test, vérifier le succès**

Run: `pnpm --filter @novi/assist exec vitest run test/errors.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9 : Lint et typecheck**

Run: `pnpm lint && pnpm --filter @novi/assist exec tsc --noEmit`
Expected: 0 erreur Biome (les 7 avertissements historiques restent), tsc silencieux.

- [ ] **Step 10 : Commit**

```bash
git add packages/assist pnpm-lock.yaml
git commit -m "feat(assist): squelette du paquet et erreurs typées

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2 : Anonymisation réversible (`privacy.ts`)

**Files:**
- Create: `packages/assist/src/privacy.ts`
- Modify: `packages/assist/src/index.ts`
- Test: `packages/assist/test/privacy.test.ts`

Contexte : le CV, la consigne et l'offre sont anonymisés avant envoi au LLM, puis la lettre est restaurée. Les jetons sont `[NOM]`, `[PRENOM]`, `[EMAIL]`, `[TELEPHONE]`, `[ADRESSE]`, `[LIEN_1]`, `[LIEN_2]`… La correspondance ignore casse et accents mais conserve le texte d'origine autour. Les valeurs de moins de 3 caractères sont ignorées. Un jeton déjà présent dans le texte d'origine est protégé.

- [ ] **Step 1 : Écrire le test**

`packages/assist/test/privacy.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { anonymize, type Identity, restore } from '../src/privacy';

const identity: Identity = {
  firstName: 'Jean-Pierre',
  lastName: 'Dupont',
  email: 'jp.dupont@example.com',
  phone: '06 12 34 56 78',
  postalAddress: '12 rue des Lilas, 06000 Nice',
  links: ['https://www.linkedin.com/in/jpdupont', 'https://github.com/jpdupont'],
  revealFirstName: false,
};

describe('anonymize', () => {
  it('replaces every known value by its token, case and accent insensitive', () => {
    const text =
      'JEAN-PIERRE DUPONT\nDéveloppeur\njp.dupont@example.com · 06 12 34 56 78\n12 rue des Lilas, 06000 Nice\nhttps://github.com/jpdupont';
    const out = anonymize(text, identity);
    expect(out).toBe('[PRENOM] [NOM]\nDéveloppeur\n[EMAIL] · [TELEPHONE]\n[ADRESSE]\n[LIEN_2]');
  });
  it('matches accented variants of the declared value', () => {
    const out = anonymize('Signé : Jérôme Lefèvre', {
      ...identity,
      firstName: 'Jerome',
      lastName: 'Lefevre',
    });
    expect(out).toBe('Signé : [PRENOM] [NOM]');
  });
  it('keeps the first name when revealFirstName is set', () => {
    expect(anonymize('Jean-Pierre Dupont', { ...identity, revealFirstName: true })).toBe('Jean-Pierre [NOM]');
  });
  it('does not touch words that merely contain the value', () => {
    expect(anonymize('Dupontel et Dupont', identity)).toBe('Dupontel et [NOM]');
  });
  it('ignores values shorter than three characters', () => {
    expect(anonymize('Li et Lili', { ...identity, lastName: 'Li' })).toBe('Li et Lili');
  });
  it('catches undeclared emails and French phone numbers', () => {
    const out = anonymize('Contact : autre@mail.fr ou +33 6 98 76 54 32 ou 04.93.00.11.22', {
      ...identity,
      email: null,
      phone: null,
    });
    expect(out).toBe('Contact : [EMAIL] ou [TELEPHONE] ou [TELEPHONE]');
  });
  it('protects tokens already present in the source text', () => {
    const out = anonymize('Le texte contient [NOM] littéralement, signé Dupont', identity);
    expect(out).toBe('Le texte contient [[NOM]] littéralement, signé [NOM]');
  });
  it('does not match inside an existing token', () => {
    expect(anonymize('[NOM] et Nom', { ...identity, lastName: 'Nom' })).toBe('[[NOM]] et [NOM]');
  });
});

describe('restore', () => {
  it('round-trips anonymize for every field', () => {
    const text =
      'Jean-Pierre Dupont, jp.dupont@example.com, 06 12 34 56 78, 12 rue des Lilas, 06000 Nice, https://www.linkedin.com/in/jpdupont';
    expect(restore(anonymize(text, identity), identity)).toBe(text);
  });
  it('fills tokens the model placed itself', () => {
    expect(restore('Cordialement,\n[PRENOM] [NOM]\n[TELEPHONE]', identity)).toBe(
      'Cordialement,\nJean-Pierre Dupont\n06 12 34 56 78',
    );
  });
  it('drops tokens without a value and tidies the spaces', () => {
    const out = restore('Signé [PRENOM] [NOM] ([LIEN_3])', {
      ...identity,
      firstName: null,
      links: [],
    });
    expect(out).toBe('Signé Dupont ()');
  });
  it('restores protected literal tokens', () => {
    expect(restore('[[NOM]] et [NOM]', identity)).toBe('[NOM] et Dupont');
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `pnpm --filter @novi/assist exec vitest run test/privacy.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : Écrire `packages/assist/src/privacy.ts`**

```ts
export type Identity = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  postalAddress?: string | null;
  links: string[];
  revealFirstName: boolean;
};

export const TOKENS = {
  firstName: '[PRENOM]',
  lastName: '[NOM]',
  email: '[EMAIL]',
  phone: '[TELEPHONE]',
  postalAddress: '[ADRESSE]',
} as const;

export function linkToken(index: number): string {
  return `[LIEN_${index + 1}]`;
}

const MIN_VALUE_LENGTH = 3;
const TOKEN_RE = /\[(NOM|PRENOM|EMAIL|TELEPHONE|ADRESSE|LIEN_\d+)\]/g;
const PROTECTED_RE = /\[\[(NOM|PRENOM|EMAIL|TELEPHONE|ADRESSE|LIEN_\d+)\]\]/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Numéros français : 0X ou +33 X, puis quatre paires de chiffres séparées ou non par espace, point ou tiret. */
const PHONE_RE = /(?:\+33[\s.-]?[1-9]|0[1-9])(?:[\s.-]?\d{2}){4}(?!\d)/g;

/**
 * Replie chaque unité de code sur sa lettre de base en minuscule, en gardant la même longueur que l'entrée,
 * pour pouvoir reporter les positions trouvées sur le texte d'origine.
 */
function fold(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const base = ch.normalize('NFD')[0] ?? ch;
    out += base.toLowerCase();
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Remplace, dans `text`, chaque occurrence de `value` (casse et accents ignorés, bornée par des non-lettres) par `token`. */
function replaceValue(text: string, value: string, token: string): string {
  const needle = fold(value.trim());
  if (needle.length < MIN_VALUE_LENGTH) return text;
  const re = new RegExp(`(?<![\\p{L}\\p{N}\\[])${escapeRegex(needle)}(?![\\p{L}\\p{N}\\]])`, 'gu');
  const folded = fold(text);
  let out = '';
  let last = 0;
  for (const m of folded.matchAll(re)) {
    const start = m.index ?? 0;
    out += text.slice(last, start) + token;
    last = start + m[0].length;
  }
  return out + text.slice(last);
}

type Replacement = { value: string; token: string };

function replacements(identity: Identity): Replacement[] {
  const list: Replacement[] = [];
  const push = (value: string | null | undefined, token: string) => {
    if (value?.trim()) list.push({ value: value.trim(), token });
  };
  push(identity.lastName, TOKENS.lastName);
  if (!identity.revealFirstName) push(identity.firstName, TOKENS.firstName);
  push(identity.email, TOKENS.email);
  push(identity.phone, TOKENS.phone);
  push(identity.postalAddress, TOKENS.postalAddress);
  identity.links.forEach((link, i) => push(link, linkToken(i)));
  // Les valeurs longues d'abord : « Jean-Pierre » part avant « Jean ».
  return list.sort((a, b) => b.value.length - a.value.length);
}

export function anonymize(text: string, identity: Identity): string {
  let out = text.replace(TOKEN_RE, '[[$1]]');
  for (const r of replacements(identity)) out = replaceValue(out, r.value, r.token);
  out = out.replace(EMAIL_RE, TOKENS.email);
  out = out.replace(PHONE_RE, TOKENS.phone);
  return out;
}

const PROTECT_MARK = '\u0000';

export function restore(text: string, identity: Identity): string {
  const values: Record<string, string> = {
    NOM: identity.lastName?.trim() ?? '',
    PRENOM: identity.firstName?.trim() ?? '',
    EMAIL: identity.email?.trim() ?? '',
    TELEPHONE: identity.phone?.trim() ?? '',
    ADRESSE: identity.postalAddress?.trim() ?? '',
  };
  identity.links.forEach((link, i) => {
    values[`LIEN_${i + 1}`] = link.trim();
  });
  let out = text.replace(PROTECTED_RE, `${PROTECT_MARK}$1${PROTECT_MARK}`);
  out = out.replace(TOKEN_RE, (_, key: string) => values[key] ?? '');
  out = out.replace(new RegExp(`${PROTECT_MARK}([A-Z_0-9]+)${PROTECT_MARK}`, 'g'), '[$1]');
  return out.replace(/ {2,}/g, ' ').replace(/ +\n/g, '\n');
}
```

- [ ] **Step 4 : Exporter depuis `index.ts`**

```ts
export * from './errors';
export * from './privacy';
```

- [ ] **Step 5 : Lancer le test, vérifier le succès**

Run: `pnpm --filter @novi/assist exec vitest run test/privacy.test.ts`
Expected: PASS, 12 tests. Si « does not match inside an existing token » échoue, vérifier que le lookbehind exclut bien `[` et le lookahead `]`.

- [ ] **Step 6 : Lint, typecheck, commit**

```bash
pnpm lint && pnpm --filter @novi/assist exec tsc --noEmit
git add packages/assist
git commit -m "feat(assist): anonymisation réversible du CV par jetons

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3 : Analyse du CV (`cv.ts`)

**Files:**
- Create: `packages/assist/src/cv.ts`
- Modify: `packages/assist/src/index.ts`
- Test: `packages/assist/test/cv.test.ts`

Contexte : `detectTechs(text, tags, confidence)` de `@novi/core` renvoie des `Detection { slug, evidence, confidence }` ; `loadTechTags()` charge le dictionnaire. `stripAccents` est aussi exporté par `@novi/core`.

- [ ] **Step 1 : Écrire le test**

`packages/assist/test/cv.test.ts` :

```ts
import { loadTechTags } from '@novi/core';
import { describe, expect, it } from 'vitest';
import { analyzeCv, CV_TECH_CONFIDENCE, detectIdentityHints } from '../src/cv';

const tags = loadTechTags();

const CV = `Jean-Pierre Dupont
Développeur full stack
jp.dupont@example.com | 06 12 34 56 78 | https://www.linkedin.com/in/jpdupont | github.com/jpdupont

Expérience Professionnelle
2022-2026 : Développeur TypeScript, React et Node.js chez Acme (PostgreSQL, Docker)
Formation
Master informatique`;

describe('analyzeCv', () => {
  it('detects technologies with the CV confidence', () => {
    const { techs } = analyzeCv(CV, tags);
    const slugs = techs.map((t) => t.slug);
    expect(slugs).toEqual(expect.arrayContaining(['typescript', 'react', 'nodejs', 'postgresql', 'docker']));
    expect(techs.every((t) => t.confidence === CV_TECH_CONFIDENCE)).toBe(true);
  });
});

describe('detectIdentityHints', () => {
  it('finds email, phone and links', () => {
    const hints = detectIdentityHints(CV);
    expect(hints.email).toBe('jp.dupont@example.com');
    expect(hints.phone).toBe('06 12 34 56 78');
    expect(hints.links).toEqual(['https://www.linkedin.com/in/jpdupont', 'https://github.com/jpdupont']);
  });
  it('proposes capitalised short lines as name candidates, skipping CV headings', () => {
    expect(detectIdentityHints(CV).nameCandidates).toEqual(['Jean-Pierre Dupont']);
  });
  it('returns empty hints on an empty text', () => {
    expect(detectIdentityHints('')).toEqual({ email: undefined, phone: undefined, links: [], nameCandidates: [] });
  });
  it('skips headings like « Expérience Professionnelle » even without a real name', () => {
    expect(detectIdentityHints('Expérience Professionnelle\nCentres Intérêts\nMarie Curie').nameCandidates).toEqual([
      'Marie Curie',
    ]);
  });
});
```

Vérifie dans `packages/core/config/tech-tags.json` que les slugs `typescript`, `react`, `nodejs`, `postgresql`, `docker` existent (`grep -n '"slug": "nodejs"'`). Si Node.js a un autre slug (par exemple `node`), adapte le test.

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `pnpm --filter @novi/assist exec vitest run test/cv.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : Écrire `packages/assist/src/cv.ts`**

```ts
import { type Detection, detectTechs, stripAccents, type TechTag } from '@novi/core';

export const CV_TECH_CONFIDENCE = 0.9;

export function analyzeCv(text: string, tags: TechTag[]): { techs: Detection[] } {
  return { techs: detectTechs(text, tags, CV_TECH_CONFIDENCE) };
}

export type IdentityHints = {
  email: string | undefined;
  phone: string | undefined;
  links: string[];
  nameCandidates: string[];
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+33[\s.-]?[1-9]|0[1-9])(?:[\s.-]?\d{2}){4}(?!\d)/;
const LINK_RE = /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|gitlab\.com)\/[\w\-./]+|https?:\/\/[^\s|)]+/g;
const NAME_LINES_SCANNED = 15;
const NAME_CANDIDATES_MAX = 3;
/** Mots fréquents dans les titres de rubrique d'un CV : une ligne qui en contient n'est pas un nom. */
const HEADING_WORDS = new Set([
  'experience',
  'experiences',
  'professionnelle',
  'professionnelles',
  'formation',
  'formations',
  'competence',
  'competences',
  'langue',
  'langues',
  'projet',
  'projets',
  'contact',
  'profil',
  'resume',
  'curriculum',
  'vitae',
  'centres',
  'interet',
  'interets',
  'developpeur',
  'developpeuse',
  'ingenieur',
  'ingenieure',
  'informatique',
  'stack',
  'full',
  'senior',
  'junior',
]);

function normalizeLink(raw: string): string {
  const trimmed = raw.replace(/[.,;:]+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function detectIdentityHints(text: string): IdentityHints {
  const email = text.match(EMAIL_RE)?.[0];
  const phone = text.match(PHONE_RE)?.[0];
  const links = [...new Set([...text.matchAll(LINK_RE)].map((m) => normalizeLink(m[0])))];
  const nameCandidates: string[] = [];
  for (const line of text.split('\n').slice(0, NAME_LINES_SCANNED)) {
    const clean = line.trim();
    if (!clean) continue;
    const words = clean.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    if (!words.every((w) => /^\p{Lu}[\p{L}'’-]*$/u.test(w))) continue;
    if (words.some((w) => HEADING_WORDS.has(stripAccents(w).toLowerCase()))) continue;
    nameCandidates.push(clean);
    if (nameCandidates.length >= NAME_CANDIDATES_MAX) break;
  }
  return { email, phone, links, nameCandidates };
}
```

- [ ] **Step 4 : Exporter depuis `index.ts`**

```ts
export * from './cv';
export * from './errors';
export * from './privacy';
```

- [ ] **Step 5 : Lancer le test, vérifier le succès**

Run: `pnpm --filter @novi/assist exec vitest run test/cv.test.ts`
Expected: PASS, 5 tests. Si « Développeur full stack » apparaît dans les candidats, c'est que `HEADING_WORDS` ne couvre pas un mot : ajoute-le.

- [ ] **Step 6 : Lint, typecheck, commit**

```bash
pnpm lint && pnpm --filter @novi/assist exec tsc --noEmit
git add packages/assist
git commit -m "feat(assist): technos et indices d'identité détectés dans le CV

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4 : Extraction PDF (`pdf.ts`)

**Files:**
- Create: `packages/assist/src/pdf.ts`
- Modify: `packages/assist/src/index.ts`
- Test: `packages/assist/test/pdf.test.ts`

Contexte : `unpdf` expose `getDocumentProxy(data: Uint8Array)` et `extractText(pdf, { mergePages: true })` qui renvoie `{ totalPages, text }`. Les tests fabriquent des PDF minimaux à la main (police Helvetica, flux non compressé), ce que pdf.js lit sans problème.

- [ ] **Step 1 : Écrire le test**

`packages/assist/test/pdf.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { AssistError } from '../src/errors';
import { extractPdfText, MAX_PDF_BYTES, MAX_PDF_PAGES } from '../src/pdf';

/** PDF 1.4 minimal : une page par texte, police Helvetica, flux non compressé, table xref calculée. */
export function makePdf(pageTexts: string[]): Uint8Array {
  const objects: string[] = [];
  const pageIds = pageTexts.map((_, i) => 4 + i * 2);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageTexts.length} >>`,
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pageTexts.forEach((text, i) => {
    const contentId = (pageIds[i] as number) + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    const escaped = text.replace(/[()\\]/g, (c) => `\\${c}`);
    const stream = `BT /F1 12 Tf 50 780 Td (${escaped}) Tj ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

describe('extractPdfText', () => {
  it('extracts and merges the text of every page', async () => {
    const pdf = makePdf(['Developpeur TypeScript React', 'Experience Node.js PostgreSQL']);
    const result = await extractPdfText(pdf);
    expect(result.pages).toBe(2);
    expect(result.text).toContain('Developpeur TypeScript React');
    expect(result.text).toContain('Node.js PostgreSQL');
  });
  it('rejects a PDF without text', async () => {
    await expect(extractPdfText(makePdf(['']))).rejects.toMatchObject({ code: 'cv_no_text' });
  });
  it('rejects more than MAX_PDF_PAGES pages', async () => {
    const pages = Array.from({ length: MAX_PDF_PAGES + 1 }, (_, i) => `Page ${i}`);
    await expect(extractPdfText(makePdf(pages))).rejects.toMatchObject({ code: 'cv_too_large' });
  });
  it('rejects a file above MAX_PDF_BYTES before parsing', async () => {
    const big = new Uint8Array(MAX_PDF_BYTES + 1);
    await expect(extractPdfText(big)).rejects.toBeInstanceOf(AssistError);
  });
  it('rejects a non-PDF buffer', async () => {
    await expect(extractPdfText(new TextEncoder().encode('hello'))).rejects.toMatchObject({ code: 'cv_not_pdf' });
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `pnpm --filter @novi/assist exec vitest run test/pdf.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : Écrire `packages/assist/src/pdf.ts`**

```ts
import { extractText, getDocumentProxy } from 'unpdf';
import { AssistError } from './errors';

export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;
const MIN_TEXT_LENGTH = 50;

function isPdf(data: Uint8Array): boolean {
  return data.length >= 5 && String.fromCharCode(...data.subarray(0, 5)) === '%PDF-';
}

/** Réduit les espaces insécables, les espaces multiples et les sauts de ligne en rafale. */
export function cleanPdfText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractPdfText(data: Uint8Array): Promise<{ text: string; pages: number }> {
  if (data.byteLength > MAX_PDF_BYTES) throw new AssistError('cv_too_large');
  if (!isPdf(data)) throw new AssistError('cv_not_pdf');
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(data);
  } catch {
    throw new AssistError('cv_not_pdf');
  }
  if (pdf.numPages > MAX_PDF_PAGES) throw new AssistError('cv_too_large');
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  const cleaned = cleanPdfText(text);
  if (cleaned.length < MIN_TEXT_LENGTH) throw new AssistError('cv_no_text');
  return { text: cleaned, pages: totalPages };
}
```

- [ ] **Step 4 : Exporter depuis `index.ts`**

```ts
export * from './cv';
export * from './errors';
export * from './pdf';
export * from './privacy';
```

- [ ] **Step 5 : Lancer le test, vérifier le succès**

Run: `pnpm --filter @novi/assist exec vitest run test/pdf.test.ts`
Expected: PASS, 5 tests. Si `getDocumentProxy` se plaint d'un worker ou de `DOMMatrix`, c'est que Vitest tourne dans un environnement non Node : vérifier qu'aucun `environment: 'jsdom'` n'est configuré pour ce paquet (il n'y a pas de `vitest.config.ts` dans `packages/assist`, l'environnement par défaut est `node`).

- [ ] **Step 6 : Lint, typecheck, commit**

```bash
pnpm lint && pnpm --filter @novi/assist exec tsc --noEmit
git add packages/assist
git commit -m "feat(assist): extraction du texte d'un CV PDF avec unpdf

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5 : Interface `TextGenerator` et adaptateur compatible OpenAI

**Files:**
- Create: `packages/assist/src/llm/types.ts`
- Create: `packages/assist/src/llm/openai-compatible.ts`
- Modify: `packages/assist/src/index.ts`
- Test: `packages/assist/test/openai-compatible.test.ts`

- [ ] **Step 1 : Écrire `packages/assist/src/llm/types.ts`**

```ts
export type GenerateInput = { system: string; prompt: string; maxTokens: number };
export type GenerateResult = { text: string; model: string };

export interface TextGenerator {
  /** Libellé affichable, par exemple « openai-compatible/gemini-2.5-flash ». */
  readonly label: string;
  generate(input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult>;
}

export const LLM_TIMEOUT_MS = 60_000;
```

- [ ] **Step 2 : Écrire le test**

`packages/assist/test/openai-compatible.test.ts` :

```ts
import { describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleGenerator } from '../src/llm/openai-compatible';

type FetchImpl = typeof fetch;

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}): FetchImpl {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers })) as unknown as FetchImpl;
}

const opts = { baseUrl: 'https://llm.example/v1/', apiKey: 'k', model: 'm' };
const input = { system: 'S', prompt: 'P', maxTokens: 100 };

describe('createOpenAiCompatibleGenerator', () => {
  it('posts to /chat/completions and returns the first choice', async () => {
    const fetchImpl = fakeFetch(200, { choices: [{ message: { content: 'Bonjour' } }], model: 'm-001' });
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl });
    const r = await gen.generate(input);
    expect(r).toEqual({ text: 'Bonjour', model: 'm-001' });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect(init.headers).toMatchObject({ authorization: 'Bearer k', 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'm',
      messages: [
        { role: 'system', content: 'S' },
        { role: 'user', content: 'P' },
      ],
      max_tokens: 100,
      temperature: 0.7,
    });
    expect(gen.label).toBe('openai-compatible/m');
  });
  it('maps 401 and 403 to unauthorized', async () => {
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl: fakeFetch(403, {}) });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'unauthorized' });
  });
  it('maps 429 to rate_limited with retry-after', async () => {
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl: fakeFetch(429, {}, { 'retry-after': '42' }) });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 42 });
  });
  it('maps other statuses to http', async () => {
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl: fakeFetch(503, {}) });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'http', status: 503 });
  });
  it('rejects a response without text', async () => {
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl: fakeFetch(200, { choices: [] }) });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'bad_response' });
  });
  it('maps an abort to timeout', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }) as unknown as FetchImpl;
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl, timeoutMs: 10 });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'timeout' });
  });
});
```

- [ ] **Step 3 : Lancer le test, vérifier l'échec**

Run: `pnpm --filter @novi/assist exec vitest run test/openai-compatible.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 4 : Écrire `packages/assist/src/llm/openai-compatible.ts`**

```ts
import { LlmError } from '../errors';
import { type GenerateInput, type GenerateResult, LLM_TIMEOUT_MS, type TextGenerator } from './types';

export type OpenAiCompatibleOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type ChatCompletion = { model?: string; choices?: { message?: { content?: string | null } }[] };

function combinedSignal(timeoutMs: number, outer?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return outer ? AbortSignal.any([outer, timeout]) : timeout;
}

export function createOpenAiCompatibleGenerator(opts: OpenAiCompatibleOptions): TextGenerator {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS;
  return {
    label: `openai-compatible/${opts.model}`,
    async generate(input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult> {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: opts.model,
            messages: [
              { role: 'system', content: input.system },
              { role: 'user', content: input.prompt },
            ],
            max_tokens: input.maxTokens,
            temperature: 0.7,
          }),
          signal: combinedSignal(timeoutMs, signal),
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw new LlmError('timeout');
        if (err instanceof Error && err.name === 'TimeoutError') throw new LlmError('timeout');
        throw new LlmError('http', { message: `Fournisseur LLM injoignable : ${(err as Error).message}` });
      }
      if (response.status === 401 || response.status === 403) throw new LlmError('unauthorized');
      if (response.status === 429) {
        const retry = Number(response.headers.get('retry-after'));
        throw new LlmError('rate_limited', {
          retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : undefined,
        });
      }
      if (!response.ok) throw new LlmError('http', { status: response.status });
      let json: ChatCompletion;
      try {
        json = (await response.json()) as ChatCompletion;
      } catch {
        throw new LlmError('bad_response');
      }
      const text = json.choices?.[0]?.message?.content?.trim();
      if (!text) throw new LlmError('bad_response');
      return { text, model: json.model ?? opts.model };
    },
  };
}
```

- [ ] **Step 5 : Exporter depuis `index.ts`**

```ts
export * from './cv';
export * from './errors';
export * from './llm/openai-compatible';
export * from './llm/types';
export * from './pdf';
export * from './privacy';
```

- [ ] **Step 6 : Lancer le test, vérifier le succès**

Run: `pnpm --filter @novi/assist exec vitest run test/openai-compatible.test.ts`
Expected: PASS, 6 tests. Si le test de timeout échoue parce que `AbortSignal.timeout` lève un `TimeoutError` et non `AbortError`, les deux noms sont déjà couverts ; vérifier que le `fetchImpl` du test écoute bien `init.signal`.

- [ ] **Step 7 : Lint, typecheck, commit**

```bash
pnpm lint && pnpm --filter @novi/assist exec tsc --noEmit
git add packages/assist
git commit -m "feat(assist): générateur de texte compatible OpenAI

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6 : Adaptateur Anthropic et fabrique `createGenerator`

**Files:**
- Create: `packages/assist/src/llm/anthropic.ts`
- Create: `packages/assist/src/llm/index.ts`
- Modify: `packages/assist/src/index.ts`
- Test: `packages/assist/test/anthropic.test.ts`
- Test: `packages/assist/test/create-generator.test.ts`

Contexte : le SDK est importé dynamiquement pour ne pas peser quand il n'est pas utilisé. API utilisée : `new Anthropic({ apiKey })`, `client.messages.create({ model, max_tokens, system, messages: [{ role: 'user', content }] })`. La réponse a `content: ({ type: 'text'; text: string } | …)[]`, `stop_reason`, `model`. Les erreurs typées sont `Anthropic.AuthenticationError`, `Anthropic.PermissionDeniedError`, `Anthropic.RateLimitError`, `Anthropic.APIConnectionTimeoutError`, `Anthropic.APIError` (avec `status`). Le modèle par défaut est `claude-opus-5-5` ; la réflexion est toujours active sur ce modèle, on ne passe donc aucun paramètre `thinking`. Le repli serveur sur refus n'est pas activé ici : un refus devient une `LlmError('refused')` affichée à l'utilisateur, ce qui suffit pour un usage personnel.

- [ ] **Step 1 : Écrire le test de l'adaptateur Anthropic**

`packages/assist/test/anthropic.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();

class APIError extends Error {
  status: number | undefined;
  constructor(status?: number, message = 'api') {
    super(message);
    this.status = status;
  }
}
class AuthenticationError extends APIError {}
class PermissionDeniedError extends APIError {}
class RateLimitError extends APIError {}
class APIConnectionTimeoutError extends APIError {}

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = { create };
    static APIError = APIError;
    static AuthenticationError = AuthenticationError;
    static PermissionDeniedError = PermissionDeniedError;
    static RateLimitError = RateLimitError;
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
  }
  return { default: Anthropic };
});

import { createAnthropicGenerator } from '../src/llm/anthropic';

const input = { system: 'S', prompt: 'P', maxTokens: 100 };

describe('createAnthropicGenerator', () => {
  beforeEach(() => create.mockReset());

  it('sends system and user message and joins text blocks', async () => {
    create.mockResolvedValue({
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: 'Bon' },
        { type: 'text', text: 'jour' },
      ],
    });
    const gen = createAnthropicGenerator({ apiKey: 'k', model: 'claude-opus-5-5' });
    expect(gen.label).toBe('anthropic/claude-opus-5-5');
    const r = await gen.generate(input);
    expect(r).toEqual({ text: 'Bonjour', model: 'claude-opus-5-5' });
    expect(create).toHaveBeenCalledWith(
      {
        model: 'claude-opus-5-5',
        max_tokens: 100,
        system: 'S',
        messages: [{ role: 'user', content: 'P' }],
      },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });
  it('maps a refusal stop reason', async () => {
    create.mockResolvedValue({ model: 'm', stop_reason: 'refusal', content: [] });
    const gen = createAnthropicGenerator({ apiKey: 'k', model: 'm' });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'refused' });
  });
  it('maps SDK errors to LlmError codes', async () => {
    const gen = createAnthropicGenerator({ apiKey: 'k', model: 'm' });
    create.mockRejectedValueOnce(new AuthenticationError(401));
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'unauthorized' });
    create.mockRejectedValueOnce(new RateLimitError(429));
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'rate_limited' });
    create.mockRejectedValueOnce(new APIConnectionTimeoutError());
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'timeout' });
    create.mockRejectedValueOnce(new APIError(500));
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'http', status: 500 });
  });
  it('rejects an empty answer', async () => {
    create.mockResolvedValue({ model: 'm', stop_reason: 'end_turn', content: [] });
    const gen = createAnthropicGenerator({ apiKey: 'k', model: 'm' });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'bad_response' });
  });
});
```

- [ ] **Step 2 : Écrire le test de la fabrique**

`packages/assist/test/create-generator.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { createGenerator, describeGenerator } from '../src/llm';

describe('createGenerator', () => {
  it('returns null when no provider is configured', () => {
    expect(createGenerator({})).toBeNull();
    expect(describeGenerator({})).toEqual({ configured: false });
  });
  it('builds an openai-compatible generator', () => {
    const env = {
      LLM_PROVIDER: 'openai-compatible',
      LLM_BASE_URL: 'https://llm.example/v1',
      LLM_API_KEY: 'k',
      LLM_MODEL: 'gemini-2.5-flash',
    };
    expect(createGenerator(env)?.label).toBe('openai-compatible/gemini-2.5-flash');
    expect(describeGenerator(env)).toEqual({ configured: true, label: 'openai-compatible/gemini-2.5-flash' });
  });
  it('builds an anthropic generator with the default model', () => {
    const env = { LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k' };
    expect(createGenerator(env)?.label).toBe('anthropic/claude-opus-5-5');
  });
  it('throws a misconfiguration error naming the missing variable', () => {
    expect(() => createGenerator({ LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'k' })).toThrow(/LLM_BASE_URL/);
    expect(describeGenerator({ LLM_PROVIDER: 'openai-compatible' })).toMatchObject({
      configured: false,
      problem: expect.stringContaining('LLM_'),
    });
  });
  it('rejects an unknown provider', () => {
    expect(() => createGenerator({ LLM_PROVIDER: 'bogus' })).toThrow(/LLM_PROVIDER/);
  });
});
```

- [ ] **Step 3 : Lancer les tests, vérifier l'échec**

Run: `pnpm --filter @novi/assist exec vitest run test/anthropic.test.ts test/create-generator.test.ts`
Expected: FAIL, modules introuvables.

- [ ] **Step 4 : Écrire `packages/assist/src/llm/anthropic.ts`**

```ts
import { LlmError } from '../errors';
import { type GenerateInput, type GenerateResult, LLM_TIMEOUT_MS, type TextGenerator } from './types';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';

export type AnthropicOptions = { apiKey: string; model: string; timeoutMs?: number };

export function createAnthropicGenerator(opts: AnthropicOptions): TextGenerator {
  const timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS;
  return {
    label: `anthropic/${opts.model}`,
    async generate(input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult> {
      // Import dynamique : le SDK n'est chargé que si ce fournisseur est choisi.
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: opts.apiKey });
      try {
        const response = await client.messages.create(
          {
            model: opts.model,
            max_tokens: input.maxTokens,
            system: input.system,
            messages: [{ role: 'user', content: input.prompt }],
          },
          { timeout: timeoutMs, signal },
        );
        if (response.stop_reason === 'refusal') throw new LlmError('refused');
        const text = response.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();
        if (!text) throw new LlmError('bad_response');
        return { text, model: response.model };
      } catch (err) {
        if (err instanceof LlmError) throw err;
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
          throw new LlmError('unauthorized');
        if (err instanceof Anthropic.RateLimitError) throw new LlmError('rate_limited');
        if (err instanceof Anthropic.APIConnectionTimeoutError) throw new LlmError('timeout');
        if (err instanceof Anthropic.APIError) throw new LlmError('http', { status: err.status });
        throw err;
      }
    },
  };
}
```

Note : `signal` dans les options de requête du SDK est pris en charge par `@anthropic-ai/sdk` 0.131 (`RequestOptions.signal`). Si `tsc` le refuse, retirer `signal` des options et garder `timeout`.

- [ ] **Step 5 : Écrire `packages/assist/src/llm/index.ts`**

```ts
import { AssistError } from '../errors';
import { ANTHROPIC_DEFAULT_MODEL, createAnthropicGenerator } from './anthropic';
import { createOpenAiCompatibleGenerator } from './openai-compatible';
import type { TextGenerator } from './types';

export type LlmEnv = Partial<Record<'LLM_PROVIDER' | 'LLM_BASE_URL' | 'LLM_API_KEY' | 'LLM_MODEL', string>>;

const PROVIDERS = ['openai-compatible', 'anthropic'] as const;

function required(env: LlmEnv, name: keyof LlmEnv): string {
  const value = env[name]?.trim();
  if (!value) throw new AssistError('llm_misconfigured', `Variable ${name} manquante dans .env (voir .env.example)`);
  return value;
}

/** `null` quand aucun fournisseur n'est déclaré ; lève `AssistError('llm_misconfigured')` si la configuration est incomplète. */
export function createGenerator(env: LlmEnv = process.env as LlmEnv): TextGenerator | null {
  const provider = env.LLM_PROVIDER?.trim();
  if (!provider) return null;
  if (provider === 'openai-compatible') {
    return createOpenAiCompatibleGenerator({
      baseUrl: required(env, 'LLM_BASE_URL'),
      apiKey: required(env, 'LLM_API_KEY'),
      model: required(env, 'LLM_MODEL'),
    });
  }
  if (provider === 'anthropic') {
    return createAnthropicGenerator({
      apiKey: required(env, 'LLM_API_KEY'),
      model: env.LLM_MODEL?.trim() || ANTHROPIC_DEFAULT_MODEL,
    });
  }
  throw new AssistError(
    'llm_misconfigured',
    `LLM_PROVIDER inconnu : « ${provider} » (valeurs possibles : ${PROVIDERS.join(', ')})`,
  );
}

export type GeneratorStatus = { configured: true; label: string } | { configured: false; problem?: string };

export function describeGenerator(env: LlmEnv = process.env as LlmEnv): GeneratorStatus {
  try {
    const gen = createGenerator(env);
    return gen ? { configured: true, label: gen.label } : { configured: false };
  } catch (err) {
    return { configured: false, problem: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 6 : Mettre à jour `packages/assist/src/index.ts`**

```ts
export * from './cv';
export * from './errors';
export * from './llm';
export * from './llm/anthropic';
export * from './llm/openai-compatible';
export * from './llm/types';
export * from './pdf';
export * from './privacy';
```

- [ ] **Step 7 : Lancer les tests, vérifier le succès**

Run: `pnpm --filter @novi/assist exec vitest run test/anthropic.test.ts test/create-generator.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 8 : Lint, typecheck, commit**

```bash
pnpm lint && pnpm --filter @novi/assist exec tsc --noEmit
git add packages/assist
git commit -m "feat(assist): adaptateur Anthropic optionnel et fabrique de générateur pilotée par .env

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7 : Prompt de lettre (`letter.ts`)

**Files:**
- Create: `packages/assist/src/letter.ts`
- Modify: `packages/assist/src/index.ts`
- Test: `packages/assist/test/letter.test.ts`

- [ ] **Step 1 : Écrire le test**

`packages/assist/test/letter.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { buildLetterPrompt, LETTER_MAX_TOKENS, type LetterInput } from '../src/letter';

const base: LetterInput = {
  profile: { homeLabel: 'Nice', skills: ['typescript', 'react'] },
  cvText: '[PRENOM] [NOM]\nDéveloppeur TypeScript',
  company: {
    name: 'Cliken Web',
    city: 'Valbonne',
    headcountLabel: '20 à 49 salariés',
    description: 'Agence web',
    techs: [
      { label: 'React', source: 'site' },
      { label: 'PostgreSQL', source: 'offre' },
    ],
    careersUrl: 'https://cliken.example/jobs',
    website: 'https://cliken.example',
  },
  revealFirstName: false,
};

describe('buildLetterPrompt', () => {
  it('asks for a spontaneous application without an offer', () => {
    const { system, prompt } = buildLetterPrompt(base);
    expect(system).toMatch(/une page/i);
    expect(system).toMatch(/\[NOM\]/);
    expect(system).toMatch(/n'invente/i);
    expect(prompt).toContain('# CV du candidat');
    expect(prompt).toContain('Cliken Web');
    expect(prompt).toContain('React (site)');
    expect(prompt).toMatch(/candidature spontanée/i);
    expect(prompt).not.toContain('# Offre');
    expect(prompt).not.toContain('# Consigne');
  });
  it('includes the offer and the instruction when provided', () => {
    const { prompt } = buildLetterPrompt({
      ...base,
      offer: { title: 'Dev React', contractType: 'CDI', description: 'Mission React', city: 'Nice' },
      instruction: 'Insister sur Rust',
    });
    expect(prompt).toContain('# Offre');
    expect(prompt).toContain('Dev React');
    expect(prompt).toContain('CDI');
    expect(prompt).toContain('# Consigne particulière');
    expect(prompt).toContain('Insister sur Rust');
    expect(prompt).toMatch(/pour cette offre/i);
  });
  it('omits empty company fields', () => {
    const { prompt } = buildLetterPrompt({
      ...base,
      company: { ...base.company, description: null, careersUrl: null, website: null, techs: [] },
    });
    expect(prompt).not.toContain('Description');
    expect(prompt).not.toContain('Technologies');
    expect(prompt).not.toContain('Page carrière');
  });
  it('tells the model the first name is real when revealed', () => {
    expect(buildLetterPrompt({ ...base, revealFirstName: true }).system).toMatch(/prénom/i);
    expect(buildLetterPrompt(base).system).not.toMatch(/le prénom du candidat est en clair/i);
  });
  it('exposes a short max tokens budget', () => {
    expect(LETTER_MAX_TOKENS).toBe(2048);
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `pnpm --filter @novi/assist exec vitest run test/letter.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : Écrire `packages/assist/src/letter.ts`**

```ts
import type { GenerateInput } from './llm/types';

export const LETTER_MAX_TOKENS = 2048;

export type LetterInput = {
  profile: { homeLabel: string; skills: string[] };
  /** Texte du CV déjà anonymisé. */
  cvText: string;
  company: {
    name: string;
    city: string | null;
    headcountLabel: string | null;
    description: string | null;
    techs: { label: string; source: string }[];
    careersUrl: string | null;
    website: string | null;
  };
  offer?: { title: string; contractType: string | null; description: string | null; city: string | null };
  instruction?: string;
  revealFirstName: boolean;
};

const SYSTEM_BASE = `Tu rédiges des lettres de motivation en français pour un développeur ou une développeuse.

Règles :
- Une page maximum, entre 250 et 350 mots, en paragraphes courts.
- Ton direct et concret, sans formules creuses ni flatterie.
- Appuie-toi uniquement sur les expériences, projets et compétences présents dans le CV : n'invente rien, aucune expérience, aucun chiffre, aucun diplôme absent du CV.
- Relie explicitement deux ou trois technos ou projets du candidat à ce que fait l'entreprise ; si une information manque, reste général plutôt que d'inventer.
- Les jetons entre crochets comme [NOM], [PRENOM], [EMAIL], [TELEPHONE], [ADRESSE] ou [LIEN_1] sont des espaces réservés : recopie-les tels quels là où l'information est attendue (en-tête, signature), sans les modifier ni les expliquer.
- Rends uniquement la lettre, sans titre, sans commentaire avant ou après.`;

const SYSTEM_REVEALED = '\n- Le prénom du candidat est en clair dans le CV ; tu peux l’utiliser dans la signature.';

function section(title: string, lines: (string | null | undefined)[]): string {
  const body = lines.filter((l): l is string => !!l && l.trim().length > 0);
  return body.length ? `# ${title}\n${body.join('\n')}` : '';
}

export function buildLetterPrompt(input: LetterInput): GenerateInput {
  const { company, offer } = input;
  const parts = [
    section('CV du candidat', [input.cvText]),
    section('Profil', [
      `Habite : ${input.profile.homeLabel}`,
      input.profile.skills.length ? `Compétences déclarées : ${input.profile.skills.join(', ')}` : null,
    ]),
    section('Entreprise', [
      `Nom : ${company.name}`,
      company.city ? `Ville : ${company.city}` : null,
      company.headcountLabel ? `Effectif : ${company.headcountLabel}` : null,
      company.description ? `Description : ${company.description}` : null,
      company.techs.length
        ? `Technologies repérées : ${company.techs.map((t) => `${t.label} (${t.source})`).join(', ')}`
        : null,
      company.website ? `Site : ${company.website}` : null,
      company.careersUrl ? `Page carrière : ${company.careersUrl}` : null,
    ]),
    offer
      ? section('Offre', [
          `Intitulé : ${offer.title}`,
          offer.contractType ? `Contrat : ${offer.contractType}` : null,
          offer.city ? `Lieu : ${offer.city}` : null,
          offer.description ? `Description :\n${offer.description}` : null,
        ])
      : '',
    input.instruction?.trim() ? section('Consigne particulière', [input.instruction.trim()]) : '',
    offer
      ? 'Rédige la lettre de motivation pour cette offre.'
      : 'Rédige la lettre de candidature spontanée pour cette entreprise.',
  ];
  return {
    system: SYSTEM_BASE + (input.revealFirstName ? SYSTEM_REVEALED : ''),
    prompt: parts.filter(Boolean).join('\n\n'),
    maxTokens: LETTER_MAX_TOKENS,
  };
}
```

- [ ] **Step 4 : Exporter depuis `index.ts`** (ajouter `export * from './letter';` dans l'ordre alphabétique).

- [ ] **Step 5 : Lancer le test, vérifier le succès**

Run: `pnpm --filter @novi/assist exec vitest run test/letter.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6 : Lint, typecheck, commit**

```bash
pnpm lint && pnpm --filter @novi/assist exec tsc --noEmit
git add packages/assist
git commit -m "feat(assist): prompt de lettre de motivation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8 : Schéma, migration 0002 et requêtes (`@novi/db`)

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/0002_<nom généré>.sql` (via drizzle-kit)
- Modify: `packages/db/src/queries.ts`
- Test: `packages/db/test/v2.test.ts`

Contexte : la migration est générée par `pnpm db:generate` (drizzle-kit lit `src/schema.ts`, écrit `drizzle/0002_*.sql` et `drizzle/meta/0002_snapshot.json` + `_journal.json`). `migrateAndSeed(createDb(':memory:'))` applique toutes les migrations dans les tests.

- [ ] **Step 1 : Écrire le test**

`packages/db/test/v2.test.ts` :

```ts
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb } from '../src/client';
import { migrateAndSeed } from '../src/migrate';
import {
  deleteCoverLetter,
  getDefaultProfile,
  insertCoverLetter,
  listCoverLetters,
  recordOfferViews,
  seenOfferIds,
} from '../src/queries';
import { companies, coverLetters, jobOffers, offerViews, profiles } from '../src/schema';

function setup() {
  const db = createDb(':memory:');
  migrateAndSeed(db);
  db.insert(companies)
    .values({
      siren: '000000001',
      name: 'Cliken Web',
      legalName: 'CLIKEN WEB',
      nafCode: '62.01Z',
      siretLocal: 'a',
      latitude: 43.6,
      longitude: 7.0,
    })
    .run();
  db.insert(jobOffers)
    .values([
      { id: 'A', title: 'Dev React', siren: '000000001' },
      { id: 'B', title: 'Dev Go', siren: '000000001' },
    ])
    .run();
  return db;
}

describe('migration 0002', () => {
  it('adds the V2 profile columns with their defaults', () => {
    const db = setup();
    const p = getDefaultProfile(db);
    expect(p.newOfferDays).toBe(7);
    expect(p.revealFirstName).toBe(false);
    expect(p.links).toEqual([]);
    expect(p.cvText).toBeNull();
    db.update(profiles)
      .set({ firstName: 'Jean', lastName: 'Dupont', cvText: 'texte', cvPages: 2, links: ['https://x.y'] })
      .where(eq(profiles.id, p.id))
      .run();
    expect(getDefaultProfile(db)).toMatchObject({ firstName: 'Jean', cvPages: 2, links: ['https://x.y'] });
  });
});

describe('offer views', () => {
  it('records unseen offers once and reports which were new', () => {
    const db = setup();
    const profileId = getDefaultProfile(db).id;
    expect(recordOfferViews(db, profileId, ['A', 'B'])).toEqual(['A', 'B']);
    expect(recordOfferViews(db, profileId, ['A', 'B'])).toEqual([]);
    expect(seenOfferIds(db, profileId)).toEqual(new Set(['A', 'B']));
    expect(db.select().from(offerViews).all()).toHaveLength(2);
  });
  it('cascades when the offer disappears', () => {
    const db = setup();
    const profileId = getDefaultProfile(db).id;
    recordOfferViews(db, profileId, ['A']);
    db.delete(jobOffers).where(eq(jobOffers.id, 'A')).run();
    expect(db.select().from(offerViews).all()).toHaveLength(0);
  });
});

describe('cover letters', () => {
  it('inserts, lists newest first and deletes for the owning profile only', () => {
    const db = setup();
    const profileId = getDefaultProfile(db).id;
    const first = insertCoverLetter(db, {
      profileId,
      siren: '000000001',
      offerId: 'A',
      instruction: null,
      content: 'Lettre 1',
      model: 'openai-compatible/m',
    });
    insertCoverLetter(db, {
      profileId,
      siren: '000000001',
      offerId: null,
      instruction: 'court',
      content: 'Lettre 2',
      model: 'openai-compatible/m',
    });
    const letters = listCoverLetters(db, profileId, '000000001');
    expect(letters.map((l) => l.content)).toEqual(['Lettre 2', 'Lettre 1']);
    expect(letters[0]?.offerTitle).toBeNull();
    expect(letters[1]?.offerTitle).toBe('Dev React');
    expect(deleteCoverLetter(db, 999, first.id)).toBe(false);
    expect(deleteCoverLetter(db, profileId, first.id)).toBe(true);
    expect(db.select().from(coverLetters).all()).toHaveLength(1);
  });
  it('keeps the letter when its offer is deleted', () => {
    const db = setup();
    const profileId = getDefaultProfile(db).id;
    insertCoverLetter(db, { profileId, siren: '000000001', offerId: 'A', instruction: null, content: 'L', model: 'm' });
    db.delete(jobOffers).where(eq(jobOffers.id, 'A')).run();
    expect(listCoverLetters(db, profileId, '000000001')[0]).toMatchObject({ offerId: null, offerTitle: null });
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `pnpm --filter @novi/db exec vitest run test/v2.test.ts`
Expected: FAIL (exports manquants).

- [ ] **Step 3 : Modifier `packages/db/src/schema.ts`**

Remplacer la définition de `profiles` par :

```ts
export const profiles = sqliteTable('profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  homeLabel: text('home_label').notNull(),
  homeLatitude: real('home_latitude').notNull(),
  homeLongitude: real('home_longitude').notNull(),
  radiusKm: real('radius_km').notNull(),
  skills: text('skills', { mode: 'json' }).$type<string[]>().notNull().default([]),
  headcountRanges: text('headcount_ranges', { mode: 'json' }).$type<string[]>().notNull().default([]),
  // V2 : identité (jamais envoyée au LLM, sert à masquer puis rétablir), CV, fenêtre de nouveauté.
  firstName: text('first_name'),
  lastName: text('last_name'),
  email: text('email'),
  phone: text('phone'),
  postalAddress: text('postal_address'),
  links: text('links', { mode: 'json' }).$type<string[]>().notNull().default([]),
  revealFirstName: integer('reveal_first_name', { mode: 'boolean' }).notNull().default(false),
  cvFilename: text('cv_filename'),
  cvText: text('cv_text'),
  cvPages: integer('cv_pages'),
  cvUploadedAt: text('cv_uploaded_at'),
  newOfferDays: integer('new_offer_days').notNull().default(7),
  ...timestamps,
});
```

Ajouter après `companyStatus` :

```ts
export const coverLetters = sqliteTable(
  'cover_letters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    profileId: integer('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    siren: text('siren')
      .notNull()
      .references(() => companies.siren, { onDelete: 'cascade' }),
    offerId: text('offer_id').references(() => jobOffers.id, { onDelete: 'set null' }),
    instruction: text('instruction'),
    content: text('content').notNull(),
    model: text('model').notNull(),
    createdAt: text('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('cover_letters_profile_siren').on(t.profileId, t.siren)],
);

export const offerViews = sqliteTable(
  'offer_views',
  {
    profileId: integer('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    offerId: text('offer_id')
      .notNull()
      .references(() => jobOffers.id, { onDelete: 'cascade' }),
    seenAt: text('seen_at').notNull().$defaultFn(now),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.offerId] })],
);
```

Et à la fin, avec les autres types :

```ts
export type CoverLetter = typeof coverLetters.$inferSelect;
export type NewCoverLetter = typeof coverLetters.$inferInsert;
```

- [ ] **Step 4 : Générer la migration**

Run: `pnpm db:generate`
Expected: `drizzle/0002_<mot>_<mot>.sql` créé, contenant `CREATE TABLE \`cover_letters\``, `CREATE TABLE \`offer_views\`` et une série de `ALTER TABLE \`profiles\` ADD \`first_name\` text;` … Vérifier avec `cat packages/db/drizzle/0002_*.sql` que les 13 colonnes sont là et que `new_offer_days` a `DEFAULT 7 NOT NULL`, `reveal_first_name` `DEFAULT false NOT NULL`, `links` `DEFAULT '[]' NOT NULL`. Ne pas éditer le SQL à la main.

- [ ] **Step 5 : Ajouter les requêtes dans `packages/db/src/queries.ts`**

Compléter l'import de schéma en haut du fichier pour inclure `coverLetters`, `jobOffers`, `offerViews`, `type NewCoverLetter`, et `desc`, `inArray` depuis `drizzle-orm` (vérifier les imports existants et compléter sans doublon). Ajouter à la fin :

```ts
/** Enregistre les offres comme vues par le profil et renvoie celles qui ne l'étaient pas encore. */
export function recordOfferViews(db: Db, profileId: number, offerIds: string[]): string[] {
  if (offerIds.length === 0) return [];
  const seen = new Set(
    db
      .select({ offerId: offerViews.offerId })
      .from(offerViews)
      .where(and(eq(offerViews.profileId, profileId), inArray(offerViews.offerId, offerIds)))
      .all()
      .map((r) => r.offerId),
  );
  const fresh = offerIds.filter((id) => !seen.has(id));
  if (fresh.length > 0) {
    db.insert(offerViews)
      .values(fresh.map((offerId) => ({ profileId, offerId })))
      .onConflictDoNothing()
      .run();
  }
  return fresh;
}

export function seenOfferIds(db: Db, profileId: number): Set<string> {
  return new Set(
    db
      .select({ offerId: offerViews.offerId })
      .from(offerViews)
      .where(eq(offerViews.profileId, profileId))
      .all()
      .map((r) => r.offerId),
  );
}

export function insertCoverLetter(db: Db, letter: Omit<NewCoverLetter, 'id' | 'createdAt'>) {
  return db.insert(coverLetters).values(letter).returning().get();
}

export type CoverLetterWithOffer = {
  id: number;
  offerId: string | null;
  offerTitle: string | null;
  instruction: string | null;
  content: string;
  model: string;
  createdAt: string;
};

export function listCoverLetters(db: Db, profileId: number, siren: string): CoverLetterWithOffer[] {
  return db
    .select({
      id: coverLetters.id,
      offerId: coverLetters.offerId,
      offerTitle: jobOffers.title,
      instruction: coverLetters.instruction,
      content: coverLetters.content,
      model: coverLetters.model,
      createdAt: coverLetters.createdAt,
    })
    .from(coverLetters)
    .leftJoin(jobOffers, eq(jobOffers.id, coverLetters.offerId))
    .where(and(eq(coverLetters.profileId, profileId), eq(coverLetters.siren, siren)))
    .orderBy(desc(coverLetters.id))
    .all();
}

/** Supprime une lettre du profil ; `false` si elle n'existe pas ou appartient à un autre profil. */
export function deleteCoverLetter(db: Db, profileId: number, id: number): boolean {
  const result = db
    .delete(coverLetters)
    .where(and(eq(coverLetters.id, id), eq(coverLetters.profileId, profileId)))
    .run();
  return result.changes > 0;
}
```

Vérifier que `and` et `eq` sont déjà importés depuis `drizzle-orm` dans ce fichier ; ajouter `desc` et `inArray`.

- [ ] **Step 6 : Lancer le test, vérifier le succès**

Run: `pnpm --filter @novi/db exec vitest run`
Expected: PASS, y compris les tests existants (le seed du profil par défaut doit continuer à fonctionner avec les nouvelles colonnes à défaut).

- [ ] **Step 7 : Lancer toute la suite pour vérifier que rien ne casse ailleurs**

Run: `pnpm test`
Expected: tous verts (les tests web et pipeline utilisent `migrateAndSeed`, donc la migration 0002 s'y applique aussi).

- [ ] **Step 8 : Lint, typecheck, commit**

```bash
pnpm lint && pnpm typecheck
git add packages/db
git commit -m "feat(db): colonnes identité/CV du profil, tables cover_letters et offer_views (migration 0002)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9 : Bonus de score pour les offres récentes (`@novi/core`)

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/score.ts`
- Test: `packages/core/test/score.test.ts` (ajout d'un bloc)

Contexte : `publishedAt` est optionnel sur les offres et `newOfferDays` optionnel sur le profil, pour ne pas casser les appels existants. `isRecentOffer` est exporté pour que l'app web utilise la même règle.

- [ ] **Step 1 : Ajouter le test**

À la fin de `packages/core/test/score.test.ts`, ajouter :

```ts
import { isRecentOffer } from '../src/score';

describe('recent offers', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  const recent = '2026-10-03T08:00:00Z';
  const old = '2026-09-01T08:00:00Z';

  it('isRecentOffer compares against newOfferDays', () => {
    expect(isRecentOffer(recent, 7, now)).toBe(true);
    expect(isRecentOffer(old, 7, now)).toBe(false);
    expect(isRecentOffer(null, 7, now)).toBe(false);
    expect(isRecentOffer('n/a', 7, now)).toBe(false);
    expect(isRecentOffer(old, 60, now)).toBe(true);
  });
  it('gives 20 points for a matching recent offer', () => {
    const r = scoreCompany(
      { ...profile, newOfferDays: 7 },
      { ...base, headcountRange: null, activeOffers: [{ techSlugs: ['react'], publishedAt: recent }] },
      30,
      now,
    );
    expect(r.lines).toContainEqual({ label: '1 offre récente correspondant au profil', points: 20 });
  });
  it('gives 15 points for a matching but old offer', () => {
    const r = scoreCompany(
      { ...profile, newOfferDays: 7 },
      { ...base, headcountRange: null, activeOffers: [{ techSlugs: ['react'], publishedAt: old }] },
      30,
      now,
    );
    expect(r.lines).toContainEqual({ label: '1 offre active correspondant au profil', points: 15 });
  });
  it('gives 10 points for recent offers without a match, 8 otherwise', () => {
    const recentNoMatch = scoreCompany(
      { ...profile, newOfferDays: 7 },
      { ...base, headcountRange: null, activeOffers: [{ techSlugs: ['php'], publishedAt: recent }, { techSlugs: [] }] },
      30,
      now,
    );
    expect(recentNoMatch.lines).toContainEqual({ label: '2 offres actives, dont une récente', points: 10 });
    const oldNoMatch = scoreCompany(
      { ...profile, newOfferDays: 7 },
      { ...base, headcountRange: null, activeOffers: [{ techSlugs: ['php'], publishedAt: old }] },
      30,
      now,
    );
    expect(oldNoMatch.lines).toContainEqual({ label: '1 offre active', points: 8 });
  });
  it('defaults newOfferDays to 7 when the profile omits it', () => {
    const r = scoreCompany(
      profile,
      { ...base, headcountRange: null, activeOffers: [{ techSlugs: ['react'], publishedAt: recent }] },
      30,
      now,
    );
    expect(r.lines[0]?.points).toBe(20);
  });
});
```

Déplacer la ligne `import { isRecentOffer } from '../src/score';` en haut du fichier avec les autres imports (Biome exige les imports en tête) : fusionner avec `import { scoreCompany } from '../src/score';` en `import { isRecentOffer, scoreCompany } from '../src/score';`.

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `pnpm --filter @novi/core exec vitest run test/score.test.ts`
Expected: FAIL, `isRecentOffer` non exporté.

- [ ] **Step 3 : Modifier `packages/core/src/types.ts`**

```ts
export type ScoreProfile = {
  skills: string[];
  radiusKm: number;
  headcountRanges: string[];
  /** Fenêtre de « nouveauté » d'une offre, en jours (7 par défaut). */
  newOfferDays?: number;
};

export type ScoreCompany = {
  headcountRange: string | null;
  techs: { slug: string; confidence: number }[];
  /** Pour chaque offre active, les slugs de technos détectées dans l'offre et sa date de publication. */
  activeOffers: { techSlugs: string[]; publishedAt?: string | null }[];
  signals: { kind: string; value: number | null }[];
};
```

- [ ] **Step 4 : Modifier `packages/core/src/score.ts`**

Remplacer les constantes d'offres et la section « Offres actives » :

```ts
const OFFER_MATCH = 15;
const OFFER_MATCH_RECENT = 20;
const OFFER_NO_MATCH = 8;
const OFFER_NO_MATCH_RECENT = 10;
export const DEFAULT_NEW_OFFER_DAYS = 7;

/** Vrai si l'offre a été publiée il y a moins de `days` jours. Dates invalides ou absentes : faux. */
export function isRecentOffer(publishedAt: string | null | undefined, days: number, now: Date = new Date()): boolean {
  if (!publishedAt) return false;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return false;
  return now.getTime() - t < days * 24 * 60 * 60 * 1000;
}
```

Signature : `export function scoreCompany(profile: ScoreProfile, company: ScoreCompany, distanceKm: number, now: Date = new Date()): ScoreResult {`

Section offres :

```ts
  // Offres actives : une offre correspondant au profil compte plus, une offre récente encore plus.
  const active = company.activeOffers.length;
  if (active > 0) {
    const days = profile.newOfferDays ?? DEFAULT_NEW_OFFER_DAYS;
    const matching = company.activeOffers.filter((o) => o.techSlugs.some((s) => skills.has(s)));
    const recentMatching = matching.filter((o) => isRecentOffer(o.publishedAt, days, now)).length;
    const anyRecent = company.activeOffers.some((o) => isRecentOffer(o.publishedAt, days, now));
    const plural = (n: number) => (n > 1 ? 's' : '');
    if (recentMatching > 0) {
      lines.push({
        label: `${recentMatching} offre${plural(recentMatching)} récente${plural(recentMatching)} correspondant au profil`,
        points: OFFER_MATCH_RECENT,
      });
    } else if (matching.length > 0) {
      lines.push({
        label: `${matching.length} offre${plural(matching.length)} active${plural(matching.length)} correspondant au profil`,
        points: OFFER_MATCH,
      });
    } else if (anyRecent) {
      lines.push({ label: `${active} offre${plural(active)} active${plural(active)}, dont une récente`, points: OFFER_NO_MATCH_RECENT });
    } else {
      lines.push({ label: `${active} offre${plural(active)} active${plural(active)}`, points: OFFER_NO_MATCH });
    }
  }
```

- [ ] **Step 5 : Lancer les tests du paquet**

Run: `pnpm --filter @novi/core exec vitest run`
Expected: PASS, tous les tests existants et les 5 nouveaux. Les anciens tests d'offres (« 1 offre active correspondant au profil », « 2 offres actives ») restent valables car leurs offres n'ont pas de `publishedAt`.

- [ ] **Step 6 : Mettre à jour la section 6 du spec V1 ? Non.** Le spec V2 (section 5) fait foi ; ne rien modifier dans le spec V1.

- [ ] **Step 7 : Lint, typecheck, commit**

```bash
pnpm lint && pnpm typecheck
git add packages/core
git commit -m "feat(core): bonus de score pour les offres récentes, isRecentOffer partagé

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10 : Commande `pipeline refresh`

**Files:**
- Create: `packages/pipeline/src/steps/refresh.ts`
- Modify: `packages/pipeline/src/cli.ts`
- Modify: `packages/pipeline/src/index.ts`
- Test: `packages/pipeline/test/refresh.test.ts`

Contexte : `withRun(db, command, args, step)` journalise dans `crawl_runs` ; `ctx.stats` accepte des clés supplémentaires numériques. `hasCredentials()` vient de `sources/france-travail`. Les étapes sont injectables pour les tests.

- [ ] **Step 1 : Écrire le test**

`packages/pipeline/test/refresh.test.ts` :

```ts
import { crawlRuns, createDb, jobOffers, migrateAndSeed } from '@novi/db';
import { desc } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { refresh } from '../src/steps/refresh';

function setup() {
  const db = createDb(':memory:');
  migrateAndSeed(db);
  db.insert(jobOffers).values({ id: 'OLD', title: 'Ancienne', createdAt: '2026-01-01T00:00:00.000Z' }).run();
  return db;
}

describe('refresh', () => {
  it('runs offers, match and signals, and counts new and linked offers', async () => {
    const db = setup();
    const steps = {
      hasCredentials: () => true,
      ingestOffres: vi.fn(async () => {
        db.insert(jobOffers).values([{ id: 'N1', title: 'Nouvelle', siren: null }, { id: 'N2', title: 'Nouvelle 2' }]).run();
        return { runId: 1, stats: { processed: 2, created: 2, updated: 0, errors: 0 }, errors: [] };
      }),
      matchOffres: vi.fn(async () => ({
        runId: 2,
        stats: { processed: 2, created: 0, updated: 1, errors: 0, matched: 1 },
        errors: [],
      })),
      computeSignals: vi.fn(async () => ({ runId: 3, stats: { processed: 0, created: 0, updated: 0, errors: 0 }, errors: [] })),
    };
    const result = await refresh(db, { departement: '06' }, steps);
    expect(result).toEqual({ newOffers: 2, linked: 1, failed: [] });
    expect(steps.ingestOffres).toHaveBeenCalledWith(db, { departement: '06' });
    const run = db.select().from(crawlRuns).orderBy(desc(crawlRuns.id)).get();
    expect(run?.command).toBe('refresh');
    expect(run?.stats).toMatchObject({ newOffers: 2, linked: 1 });
    expect(run?.finishedAt).not.toBeNull();
  });
  it('continues after a failed step and reports it', async () => {
    const db = setup();
    const steps = {
      hasCredentials: () => true,
      ingestOffres: vi.fn(async () => {
        throw new Error('boom');
      }),
      matchOffres: vi.fn(async () => ({ runId: 2, stats: { processed: 0, created: 0, updated: 0, errors: 0, matched: 0 }, errors: [] })),
      computeSignals: vi.fn(async () => ({ runId: 3, stats: { processed: 0, created: 0, updated: 0, errors: 0 }, errors: [] })),
    };
    const result = await refresh(db, { departement: '06' }, steps);
    expect(result.failed).toEqual(['ingest offres']);
    expect(steps.matchOffres).toHaveBeenCalled();
    expect(steps.computeSignals).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
  it('stops immediately without credentials', async () => {
    const db = setup();
    const steps = {
      hasCredentials: () => false,
      ingestOffres: vi.fn(),
      matchOffres: vi.fn(),
      computeSignals: vi.fn(),
    };
    const result = await refresh(db, { departement: '06' }, steps);
    expect(result).toEqual({ newOffers: 0, linked: 0, failed: ['credentials'] });
    expect(steps.ingestOffres).not.toHaveBeenCalled();
    expect(db.select().from(crawlRuns).all()).toHaveLength(0);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `pnpm --filter @novi/pipeline exec vitest run test/refresh.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : Écrire `packages/pipeline/src/steps/refresh.ts`**

```ts
import { type Db, jobOffers } from '@novi/db';
import { and, gte, isNotNull, sql } from 'drizzle-orm';
import { log, warn } from '../lib/logger';
import { type RunResult, withRun } from '../lib/run';
import { hasCredentials as defaultHasCredentials } from '../sources/france-travail';
import { ingestOffres as defaultIngestOffres } from './ingest-offres';
import { matchOffres as defaultMatchOffres } from './match-offres';
import { computeSignals as defaultComputeSignals } from './signals';

export type RefreshOptions = { departement: string };

export type RefreshSteps = {
  hasCredentials: () => boolean;
  ingestOffres: (db: Db, opts: { departement: string }) => Promise<RunResult>;
  matchOffres: (db: Db, opts: { force?: boolean }) => Promise<RunResult>;
  computeSignals: (db: Db) => Promise<RunResult>;
};

export type RefreshResult = { newOffers: number; linked: number; failed: string[] };

const DEFAULT_STEPS: RefreshSteps = {
  hasCredentials: defaultHasCredentials,
  ingestOffres: defaultIngestOffres,
  matchOffres: defaultMatchOffres,
  computeSignals: defaultComputeSignals,
};

/**
 * Rafraîchissement léger destiné à la planification : offres France Travail, rattachement, signaux.
 * Chaque sous-étape garde son propre run ; un run `refresh` englobant porte le résumé.
 */
export async function refresh(
  db: Db,
  opts: RefreshOptions,
  steps: RefreshSteps = DEFAULT_STEPS,
): Promise<RefreshResult> {
  if (!steps.hasCredentials()) {
    warn('Identifiants France Travail absents : refresh impossible (voir .env.example)');
    process.exitCode = 1;
    return { newOffers: 0, linked: 0, failed: ['credentials'] };
  }
  const startedAt = new Date().toISOString();
  const failed: string[] = [];
  let linked = 0;
  const result = await withRun(db, 'refresh', { departement: opts.departement }, async (ctx) => {
    const step = async (name: string, fn: () => Promise<RunResult | void>) => {
      try {
        return await fn();
      } catch (err) {
        failed.push(name);
        ctx.error(undefined, err);
        return undefined;
      }
    };
    await step('ingest offres', () => steps.ingestOffres(db, { departement: opts.departement }));
    const match = await step('match offres', () => steps.matchOffres(db, {}));
    linked = Number(match?.stats.matched ?? 0);
    await step('signals', () => steps.computeSignals(db));
    const fresh = db
      .select({ n: sql<number>`count(*)` })
      .from(jobOffers)
      .where(and(gte(jobOffers.createdAt, startedAt), isNotNull(jobOffers.id)))
      .get();
    ctx.stats.newOffers = fresh?.n ?? 0;
    ctx.stats.linked = linked;
    ctx.stats.processed = ctx.stats.newOffers;
  });
  const newOffers = Number(result.stats.newOffers ?? 0);
  if (failed.length > 0) {
    process.exitCode = 1;
    warn(`Refresh terminé avec ${failed.length} étape(s) en échec : ${failed.join(', ')}`);
  } else {
    log(`Refresh terminé : ${newOffers} nouvelle(s) offre(s), ${linked} rattachée(s)`);
  }
  return { newOffers, linked, failed };
}
```

Note : `withRun` relance l'erreur si `step` lève ; ici chaque sous-étape est capturée, donc `withRun` ne lève jamais. `isNotNull(jobOffers.id)` est inoffensif, il n'existe que pour garder `and(...)` typé si on ajoute un filtre plus tard ; tu peux le retirer et passer `gte(...)` seul.

- [ ] **Step 4 : Brancher la CLI**

Dans `packages/pipeline/src/cli.ts`, importer `refresh` et ajouter avant `program.parseAsync` :

```ts
program
  .command('refresh')
  .description('Rafraîchissement léger : offres France Travail, rattachement, signaux (pour la planification)')
  .option('-d, --departement <code>', 'département', '06')
  .action(async (opts: { departement: string }) => {
    await refresh(getDb(), opts);
  });
```

Dans `packages/pipeline/src/index.ts`, ajouter `export * from './steps/refresh';` à sa place alphabétique.

- [ ] **Step 5 : Lancer le test, vérifier le succès**

Run: `pnpm --filter @novi/pipeline exec vitest run test/refresh.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6 : Vérifier l'aide de la CLI sans toucher à la base**

Run: `pnpm pipeline refresh --help`
Expected: affiche l'option `-d, --departement`. (`--help` n'ouvre pas la base.)

- [ ] **Step 7 : Lint, typecheck, commit**

```bash
pnpm lint && pnpm typecheck
git add packages/pipeline
git commit -m "feat(pipeline): commande refresh (offres, rattachement, signaux) avec résumé des nouveautés

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11 : Planification Windows, `.env.example`, README

**Files:**
- Create: `scripts/install-refresh-task.ps1`
- Create: `scripts/uninstall-refresh-task.ps1`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `.gitignore` (ajouter `data/logs/` : déjà couvert par `data/`, vérifier et ne rien faire si c'est le cas)

- [ ] **Step 1 : Écrire `scripts/install-refresh-task.ps1`**

```powershell
<#
.SYNOPSIS
  Enregistre une tâche planifiée Windows « Novi refresh » qui lance `pnpm pipeline refresh` à intervalle régulier.
.PARAMETER IntervalHours
  Intervalle entre deux exécutions (défaut 6).
.PARAMETER Departement
  Département passé au pipeline (défaut 06).
.EXAMPLE
  pwsh scripts/install-refresh-task.ps1 -IntervalHours 4
#>
param(
  [int]$IntervalHours = 6,
  [string]$Departement = '06'
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Novi refresh'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LogDir = Join-Path $RepoRoot 'data\logs'
$LogFile = Join-Path $LogDir 'refresh.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$pnpm = (Get-Command pnpm -ErrorAction Stop).Source
$pwsh = (Get-Command pwsh -ErrorAction Stop).Source

# Le journal est tronqué aux 500 dernières lignes quand il dépasse 1 Mo, puis la commande y ajoute sa sortie.
$Inner = @"
Set-Location '$RepoRoot'
if ((Test-Path '$LogFile') -and ((Get-Item '$LogFile').Length -gt 1MB)) {
  Get-Content '$LogFile' -Tail 500 | Set-Content '$LogFile'
}
"=== refresh `$(Get-Date -Format s)" | Add-Content '$LogFile'
& '$pnpm' pipeline refresh -d $Departement *>> '$LogFile'
"@
$Encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Inner))

$Action = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand $Encoded" -WorkingDirectory $RepoRoot
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours $IntervalHours)
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Novi : rafraîchissement des offres France Travail toutes les $IntervalHours h" -Force | Out-Null

$Info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "Tâche « $TaskName » enregistrée : toutes les $IntervalHours h, journal dans $LogFile"
Write-Host "Prochaine exécution : $($Info.NextRunTime)"
```

- [ ] **Step 2 : Écrire `scripts/uninstall-refresh-task.ps1`**

```powershell
<#
.SYNOPSIS
  Supprime la tâche planifiée « Novi refresh ».
#>
$ErrorActionPreference = 'Stop'
$TaskName = 'Novi refresh'
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Tâche « $TaskName » supprimée."
} else {
  Write-Host "Aucune tâche « $TaskName » à supprimer."
}
```

- [ ] **Step 3 : Vérifier la syntaxe PowerShell sans enregistrer de tâche**

Run (PowerShell) :

```powershell
$null = [System.Management.Automation.Language.Parser]::ParseFile("$PWD/scripts/install-refresh-task.ps1", [ref]$null, [ref]$errors); $errors.Count
$null = [System.Management.Automation.Language.Parser]::ParseFile("$PWD/scripts/uninstall-refresh-task.ps1", [ref]$null, [ref]$errors2); $errors2.Count
```

Expected: `0` et `0`. Ne pas exécuter le script d'installation pendant le développement : c'est l'utilisateur qui l'exécutera.

- [ ] **Step 4 : Compléter `.env.example`**

```
FRANCE_TRAVAIL_CLIENT_ID=
FRANCE_TRAVAIL_CLIENT_SECRET=
GITHUB_TOKEN=
DATABASE_URL=file:./data/novi.db

# Lettres de motivation (facultatif : sans LLM_PROVIDER la fonctionnalité est masquée).
# Un seul adaptateur « compatible OpenAI » couvre les paliers gratuits courants :
#   Gemini (Google AI Studio) : LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai  LLM_MODEL=gemini-2.5-flash
#   Groq                      : LLM_BASE_URL=https://api.groq.com/openai/v1                           LLM_MODEL=llama-3.3-70b-versatile
#   Mistral                   : LLM_BASE_URL=https://api.mistral.ai/v1                                LLM_MODEL=mistral-small-latest
#   Ollama (local)            : LLM_BASE_URL=http://localhost:11434/v1  LLM_API_KEY=ollama            LLM_MODEL=<modèle installé>
# Les identifiants de modèles changent : vérifier la liste du fournisseur le jour de la création de la clé.
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=
LLM_MODEL=gemini-2.5-flash

# Variante Anthropic (payant à l'usage, crédits prépayés) : LLM_PROVIDER=anthropic, LLM_API_KEY=sk-ant-..., LLM_MODEL facultatif (claude-opus-5-5).
```

- [ ] **Step 5 : Compléter `README.md`**

Dans « Prérequis », ajouter : « Facultatif : une clé d'un fournisseur LLM à palier gratuit (Google AI Studio pour Gemini, Groq ou Mistral) pour générer des lettres de motivation ; voir `.env.example`. »

Dans le tableau des commandes du pipeline, ajouter la ligne :

| `pnpm pipeline refresh -d 06` | Offres France Travail, rattachement, signaux, puis résumé « N nouvelles offres ». Conçu pour la planification. |

Ajouter une section après « Commandes du pipeline » :

```markdown
## Rafraîchissement automatique

Sous Windows, une tâche planifiée lance `pnpm pipeline refresh` toutes les 6 heures (modifiable) :

```powershell
pwsh scripts/install-refresh-task.ps1            # toutes les 6 h
pwsh scripts/install-refresh-task.ps1 -IntervalHours 3
pwsh scripts/uninstall-refresh-task.ps1
```

Le journal est dans `data/logs/refresh.log`. La page `/pipeline` affiche la date du dernier refresh et prévient s'il date de plus de 12 h.

Sous macOS ou Linux, l'équivalent `cron` : `0 */6 * * * cd /chemin/vers/Novi && pnpm pipeline refresh -d 06 >> data/logs/refresh.log 2>&1`.
```

Dans « Structure », ajouter : « `packages/assist` : extraction du CV (PDF), anonymisation réversible, adaptateurs LLM et prompt de lettre. Aucune dépendance à la base. »

- [ ] **Step 6 : Lint et commit**

```bash
pnpm lint
git add scripts .env.example README.md
git commit -m "docs: planification Windows du refresh, variables LLM, paquet assist

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12 : Vérification finale et fusion

- [ ] **Step 1 : Suite complète**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: 0 erreur Biome, tsc silencieux, tous les tests verts (26 fichiers V1 + 8 nouveaux environ).

- [ ] **Step 2 : Build web inchangé**

Run: `pnpm build`
Expected: succès (l'app web n'utilise pas encore `@novi/assist`, mais la migration 0002 et le type `Profile` élargi ne doivent rien casser).

- [ ] **Step 3 : Appliquer la migration sur la vraie base**

Run: `pnpm db:migrate`
Expected: `Base migrée et initialisée : …/data/novi.db`. Vérifier qu'aucun pipeline ni serveur de dev ne tourne avant (sinon `SQLITE_BUSY`).

- [ ] **Step 4 : Fusion**

```bash
git checkout master
git merge --ff-only plan-3-assist
git log --oneline -1
```

Ne pas pousser sur `origin` sans demande explicite de l'utilisateur.

---

## Auto-revue du plan

- **Couverture du spec** : §2 architecture → Tâches 1–7 ; §3 modèle → Tâche 8 ; §4.1 → Tâche 4 ; §4.2 → Tâche 3 ; §4.3 → Tâche 2 ; §4.4 → Tâches 5–6 ; §4.5 → Tâche 7 ; §5 → Tâche 9 ; §6 → Tâches 10–11 ; §10 mise en route → Tâche 11 (README, .env.example) et Tâche 12 (migration). §7 (web) et §8–9 côté web sont dans le plan 4.
- **Types partagés avec le plan 4** : `Identity`, `anonymize`, `restore`, `extractPdfText`, `analyzeCv`, `detectIdentityHints`, `createGenerator`, `describeGenerator`, `buildLetterPrompt`, `LetterInput`, `LETTER_MAX_TOKENS`, `AssistError`, `LlmError` (assist) ; `recordOfferViews`, `seenOfferIds`, `insertCoverLetter`, `listCoverLetters`, `deleteCoverLetter`, `CoverLetterWithOffer`, `coverLetters`, `offerViews` (db) ; `isRecentOffer`, `DEFAULT_NEW_OFFER_DAYS`, `ScoreProfile.newOfferDays`, `activeOffers[].publishedAt` (core) ; `refresh` (pipeline).
