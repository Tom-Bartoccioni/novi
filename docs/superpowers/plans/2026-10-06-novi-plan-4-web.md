# Novi V2 — Plan 4 : application web (CV, lettres, nouvelles offres)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brancher dans l'app Next.js tout ce que le plan 3 a livré : import du CV et identité sur `/profil`, génération de lettres anonymisées sur la fiche entreprise, badges et filtre « nouvelles offres » sur l'exploration et la carte, suivi des offres vues, et état du refresh sur `/pipeline`.

**Architecture:** La couche de données (`apps/web/src/lib/data.ts`) reste la seule à interroger la base ; les mutations synchrones vivent dans `lib/mutations.ts`, la génération de lettre dans `lib/letters.ts` (générateur injecté, donc testable sans réseau), et les actions serveur (`app/actions.ts`) orchestrent. Les composants client n'importent jamais `@novi/db`, `@novi/pipeline` ni `@novi/assist`.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), React 19, Tailwind 4, shadcn (Base UI), MapLibre GL 6, Vitest. Dépend de `@novi/assist`, `@novi/db` et `@novi/core` tels que livrés par le plan 3.

**Spec :** `docs/superpowers/specs/2026-10-06-novi-v2-assist-design.md`, sections 7 à 9.

**Prérequis :** plan 3 fusionné dans `master`. Branche `plan-4-web` créée depuis `master`.

**Conventions du dépôt :**
- LF, `pnpm lint` (0 erreur, 7 avertissements historiques), `pnpm typecheck`, `pnpm test`.
- Libellés et messages en français.
- Ne pas lancer le pipeline ni modifier `data/novi.db`. Si un serveur `pnpm dev` tourne dans une autre fenêtre, le laisser : il recharge à chaud.
- Tests web : `pnpm --filter @novi/web exec vitest run test/<fichier>.test.ts`. `test/helpers.ts` fournit `seededDb()` (trois entreprises, trois offres, profil par défaut).
- Un fichier `'use server'` n'exporte que des fonctions asynchrones.

---

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `apps/web/package.json`, `next.config.ts` | Dépendances `@novi/assist`, `dotenv` ; transpilation et externalisation |
| `apps/web/src/lib/assist.ts` | Chargement `.env`, `llmStatus()`, `identityFromProfile()` |
| `apps/web/src/lib/data.ts` | Filtres `nouvelles`, `recentOffers`/`unseenOffers`, récence dans le score, vues, lettres, dernier refresh |
| `apps/web/src/lib/mutations.ts` | `ProfileInput` étendu, `applyCv` |
| `apps/web/src/lib/letters.ts` | `generateLetterFor(db, profile, request, generator)` |
| `apps/web/src/app/actions.ts` | `uploadCv`, `generateLetter`, `deleteLetter` |
| `apps/web/src/components/cv-section.tsx` | Import du CV, technos détectées, candidats nom |
| `apps/web/src/components/profile-form.tsx`, `app/profil/page.tsx` | Identité, nouveautés, CV |
| `apps/web/src/components/letter-panel.tsx`, `app/entreprises/[siren]/page.tsx` | Lettres, badges d'offres |
| `apps/web/src/components/{company-map,company-list,filters}.tsx`, `app/page.tsx` | Marqueurs, badge, filtre, bandeau |
| `apps/web/src/app/pipeline/page.tsx` | Dernier refresh |
| `apps/web/test/{data-v2,mutations-v2,letters}.test.ts` | Tests |
| `README.md` | Routes et usage |

---

### Task 0 : Branche de travail

- [ ] **Step 1**

```bash
cd C:/Users/tomba/Downloads/Novi
git checkout master
git checkout -b plan-4-web
```

---

### Task 1 : Dépendances, configuration Next et `lib/assist.ts`

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/next.config.ts`
- Create: `apps/web/src/lib/assist.ts`
- Test: `apps/web/test/assist-lib.test.ts`

- [ ] **Step 1 : Ajouter les dépendances**

Dans `apps/web/package.json`, section `dependencies`, ajouter (ordre alphabétique) :

```json
    "@novi/assist": "workspace:*",
    "dotenv": "^18.0.4",
```

Run: `pnpm install`
Expected: succès.

- [ ] **Step 2 : Modifier `apps/web/next.config.ts`**

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@novi/core', '@novi/db', '@novi/pipeline', '@novi/assist'],
  // better-sqlite3 est natif ; unpdf embarque pdf.js et le SDK Anthropic est importé dynamiquement :
  // aucun des trois ne doit passer par le bundler.
  serverExternalPackages: ['better-sqlite3', 'unpdf', '@anthropic-ai/sdk'],
  agentRules: false,
};

export default nextConfig;
```

- [ ] **Step 3 : Écrire le test**

`apps/web/test/assist-lib.test.ts` :

```ts
import { getDefaultProfile, profiles } from '@novi/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { identityFromProfile } from '@/lib/assist';
import { seededDb } from './helpers';

describe('identityFromProfile', () => {
  it('maps the profile columns to an Identity', () => {
    const db = seededDb();
    const p = getDefaultProfile(db);
    db.update(profiles)
      .set({ firstName: ' Jean ', lastName: 'Dupont', email: 'j@d.fr', links: ['https://a.b'], revealFirstName: true })
      .where(eq(profiles.id, p.id))
      .run();
    expect(identityFromProfile(getDefaultProfile(db))).toEqual({
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'j@d.fr',
      phone: null,
      postalAddress: null,
      links: ['https://a.b'],
      revealFirstName: true,
    });
  });
});
```

- [ ] **Step 4 : Écrire `apps/web/src/lib/assist.ts`**

```ts
import { join } from 'node:path';
import { describeGenerator, type GeneratorStatus, type Identity } from '@novi/assist';
import { findRepoRoot, type Profile } from '@novi/db';
import { config as loadEnv } from 'dotenv';

// Next.js ne lit que le .env de apps/web ; celui du dépôt porte les variables LLM_*.
loadEnv({ path: join(findRepoRoot(), '.env'), quiet: true });

export function llmStatus(): GeneratorStatus {
  return describeGenerator(process.env);
}

function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export function identityFromProfile(profile: Profile): Identity {
  return {
    firstName: clean(profile.firstName),
    lastName: clean(profile.lastName),
    email: clean(profile.email),
    phone: clean(profile.phone),
    postalAddress: clean(profile.postalAddress),
    links: profile.links.map((l) => l.trim()).filter(Boolean),
    revealFirstName: profile.revealFirstName,
  };
}
```

- [ ] **Step 5 : Test, lint, typecheck, commit**

```bash
pnpm --filter @novi/web exec vitest run test/assist-lib.test.ts
pnpm lint && pnpm --filter @novi/web exec tsc --noEmit
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): dépendance @novi/assist, statut LLM et identité du profil

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2 : Couche de données : nouveautés, vues, lettres, dernier refresh

**Files:**
- Modify: `apps/web/src/lib/data.ts`
- Test: `apps/web/test/data-v2.test.ts`

- [ ] **Step 1 : Écrire le test**

`apps/web/test/data-v2.test.ts` :

```ts
import { crawlRuns, getDefaultProfile, jobOffers, offerViews, profiles } from '@novi/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  countUnseenOffersInRadius,
  getCompanyDetail,
  listCompanies,
  parseFilters,
  pipelineOverview,
} from '@/lib/data';
import { seededDb } from './helpers';

const NOW = new Date('2026-10-06T12:00:00Z');
const RECENT = '2026-10-05T09:00:00Z';

function withRecentOffer() {
  const db = seededDb();
  db.insert(jobOffers)
    .values({ id: 'D', title: 'Dev TypeScript', description: 'TypeScript', siren: '000000001', publishedAt: RECENT })
    .run();
  const profile = getDefaultProfile(db);
  db.update(profiles).set({ skills: ['typescript'] }).where(eq(profiles.id, profile.id)).run();
  return { db, profile: getDefaultProfile(db) };
}

describe('parseFilters', () => {
  it('reads the nouvelles flag', () => {
    expect(parseFilters({ nouvelles: '1' }).nouvelles).toBe(true);
    expect(parseFilters({}).nouvelles).toBe(false);
  });
});

describe('listCompanies V2', () => {
  it('counts recent and unseen offers per company', () => {
    const { db, profile } = withRecentOffer();
    const items = listCompanies(db, profile, parseFilters({}), NOW);
    const cliken = items.find((c) => c.siren === '000000001');
    expect(cliken).toMatchObject({ recentOffers: 1, unseenOffers: 2, recruiting: true });
    expect(items.find((c) => c.siren === '000000002')).toMatchObject({ recentOffers: 0, unseenOffers: 0 });
  });
  it('filters on nouvelles', () => {
    const { db, profile } = withRecentOffer();
    const items = listCompanies(db, profile, parseFilters({ nouvelles: '1' }), NOW);
    expect(items.map((c) => c.siren)).toEqual(['000000001']);
  });
  it('uses the profile window in the score', () => {
    const { db, profile } = withRecentOffer();
    const recent = listCompanies(db, profile, parseFilters({}), NOW).find((c) => c.siren === '000000001');
    db.update(profiles).set({ newOfferDays: 0 }).where(eq(profiles.id, profile.id)).run();
    const noWindow = listCompanies(db, getDefaultProfile(db), parseFilters({}), NOW).find(
      (c) => c.siren === '000000001',
    );
    expect((recent?.score ?? 0) - (noWindow?.score ?? 0)).toBe(5);
  });
  it('decrements unseen once the offers were viewed', () => {
    const { db, profile } = withRecentOffer();
    db.insert(offerViews).values({ profileId: profile.id, offerId: 'A' }).run();
    const cliken = listCompanies(db, profile, parseFilters({}), NOW).find((c) => c.siren === '000000001');
    expect(cliken?.unseenOffers).toBe(1);
  });
});

describe('getCompanyDetail V2', () => {
  it('flags recent and unseen offers and records the views when asked', () => {
    const { db, profile } = withRecentOffer();
    const first = getCompanyDetail(db, profile, '000000001', { markSeen: true, now: NOW });
    expect(first?.activeOffers.map((o) => [o.id, o.isRecent, o.unseen])).toEqual([
      ['D', true, true],
      ['A', false, true],
    ]);
    const second = getCompanyDetail(db, profile, '000000001', { markSeen: true, now: NOW });
    expect(second?.activeOffers.every((o) => o.unseen === false)).toBe(true);
    expect(db.select().from(offerViews).all()).toHaveLength(2);
  });
  it('does not record views by default', () => {
    const { db, profile } = withRecentOffer();
    getCompanyDetail(db, profile, '000000001');
    expect(db.select().from(offerViews).all()).toHaveLength(0);
  });
  it('returns the cover letters of the company', () => {
    const { db, profile } = withRecentOffer();
    expect(getCompanyDetail(db, profile, '000000001')?.letters).toEqual([]);
  });
});

describe('countUnseenOffersInRadius', () => {
  it('counts active linked offers of companies in radius not yet viewed', () => {
    const { db, profile } = withRecentOffer();
    expect(countUnseenOffersInRadius(db, profile)).toBe(2);
    db.insert(offerViews).values({ profileId: profile.id, offerId: 'D' }).run();
    expect(countUnseenOffersInRadius(db, profile)).toBe(1);
  });
});

describe('pipelineOverview V2', () => {
  it('exposes the last finished refresh run and whether it is stale', () => {
    const db = seededDb();
    expect(pipelineOverview(db, NOW).lastRefresh).toBeNull();
    db.insert(crawlRuns)
      .values({
        command: 'refresh',
        startedAt: '2026-10-06T08:00:00.000Z',
        finishedAt: '2026-10-06T08:01:00.000Z',
        stats: { processed: 3, created: 0, updated: 0, errors: 0, newOffers: 3, linked: 1 },
      })
      .run();
    const fresh = pipelineOverview(db, NOW);
    expect(fresh.lastRefresh?.stats).toMatchObject({ newOffers: 3 });
    expect(fresh.refreshStale).toBe(false);
    expect(pipelineOverview(db, new Date('2026-10-07T12:00:00Z')).refreshStale).toBe(true);
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `pnpm --filter @novi/web exec vitest run test/data-v2.test.ts`
Expected: FAIL (exports et champs manquants).

- [ ] **Step 3 : Modifier `apps/web/src/lib/data.ts`**

Imports : ajouter `isRecentOffer` à l'import de `@novi/core` ; ajouter `type CoverLetterWithOffer`, `listCoverLetters`, `recordOfferViews`, `seenOfferIds` à l'import de `@novi/db`.

`Filters` et `parseFilters` :

```ts
export type Filters = {
  techs: string[];
  headcount: string[];
  recruiting: boolean;
  nouvelles: boolean;
  status: CompanyStatus | null;
  sort: Sort;
  q: string;
};
```

et dans `parseFilters` : `nouvelles: first(params.nouvelles) === '1',`.

`CompanyListItem` : ajouter `recentOffers: number;` et `unseenOffers: number;` après `recruiting`.

Remplacer `ScoredOffer`, `activeOfferTechs`, `scoreFromParts` :

```ts
type ScoredOffer = { id: string; techSlugs: string[]; publishedAt: string | null };
type ScoredSignal = { kind: string; value: number | null };

function activeOffersOf(db: Db, siren: string): ScoredOffer[] {
  return db
    .select({ id: jobOffers.id, title: jobOffers.title, description: jobOffers.description, publishedAt: jobOffers.publishedAt })
    .from(jobOffers)
    .where(and(eq(jobOffers.siren, siren), eq(jobOffers.isActive, true)))
    .all()
    .map((o) => ({ id: o.id, techSlugs: offerTechSlugs(o), publishedAt: o.publishedAt }));
}

/** Score pur : aucune requête, toutes les données sont fournies par l'appelant. */
function scoreFromParts(
  profile: Profile,
  company: Pick<Company, 'headcountRange'>,
  distanceKm: number,
  techs: { tagSlug: string; confidence: number }[],
  offers: ScoredOffer[],
  sig: ScoredSignal[],
  now: Date,
): ScoreResult {
  return scoreCompany(
    {
      skills: profile.skills,
      radiusKm: profile.radiusKm,
      headcountRanges: profile.headcountRanges,
      newOfferDays: profile.newOfferDays,
    },
    {
      headcountRange: company.headcountRange,
      techs: techs.map((t) => ({ slug: t.tagSlug, confidence: t.confidence })),
      activeOffers: offers,
      signals: sig,
    },
    distanceKm,
    now,
  );
}
```

`listCompanies(db, profile, filters, now = new Date())` : la requête des offres actives sélectionne aussi `id` et `publishedAt` ; après `statusBySiren`, ajouter `const seen = seenOfferIds(db, profile.id);`. Dans la boucle :

```ts
    const offers = offersBySiren.get(c.siren) ?? [];
    const recruiting = offers.length > 0;
    const recentOffers = offers.filter((o) => isRecentOffer(o.publishedAt, profile.newOfferDays, now)).length;
    const unseenOffers = offers.filter((o) => !seen.has(o.id)).length;
    …
    if (filters.recruiting && !recruiting) continue;
    if (filters.nouvelles && recentOffers === 0) continue;
    …
      recruiting,
      recentOffers,
      unseenOffers,
      score: scoreFromParts(profile, c, c.distanceKm, techs, offers, signalsBySiren.get(c.siren) ?? [], now).score,
```

et `pushTo(offersBySiren, siren, { id: o.id, techSlugs: offerTechSlugs(o), publishedAt: o.publishedAt })`.

`CompanyDetail` : les offres gagnent `isRecent: boolean; unseen: boolean;` et le détail gagne `letters: CoverLetterWithOffer[];`.

`getCompanyDetail(db, profile, siren, opts: { markSeen?: boolean; now?: Date } = {})` :

```ts
  const now = opts.now ?? new Date();
  const offers = activeOffersOf(db, siren);
  const offerRows = db
    .select({ id: jobOffers.id, title: jobOffers.title, contractType: jobOffers.contractType, publishedAt: jobOffers.publishedAt, url: jobOffers.url })
    .from(jobOffers)
    .where(and(eq(jobOffers.siren, siren), eq(jobOffers.isActive, true)))
    .orderBy(desc(jobOffers.publishedAt))
    .all();
  let unseen: Set<string>;
  if (opts.markSeen) {
    try {
      unseen = new Set(recordOfferViews(db, profile.id, offerRows.map((o) => o.id)));
    } catch (err) {
      console.warn(`offer_views : ${err instanceof Error ? err.message : String(err)}`);
      unseen = new Set();
    }
  } else {
    const seen = seenOfferIds(db, profile.id);
    unseen = new Set(offerRows.filter((o) => !seen.has(o.id)).map((o) => o.id));
  }
  const activeOffers = offerRows.map((o) => ({
    ...o,
    isRecent: isRecentOffer(o.publishedAt, profile.newOfferDays, now),
    unseen: unseen.has(o.id),
  }));
```

et dans le retour : `score: scoreFromParts(profile, company, distanceKm, techRows, offers, sig, now)`, `letters: listCoverLetters(db, profile.id, siren)`.

Ajouter après `countCompanies` :

```ts
/** Offres actives rattachées à une entreprise du rayon et jamais affichées dans une fiche. */
export function countUnseenOffersInRadius(db: Db, profile: Profile): number {
  const sirens = new Set(
    companiesWithinRadius(db, { latitude: profile.homeLatitude, longitude: profile.homeLongitude }, profile.radiusKm).map(
      (c) => c.siren,
    ),
  );
  const seen = seenOfferIds(db, profile.id);
  return db
    .select({ id: jobOffers.id, siren: jobOffers.siren })
    .from(jobOffers)
    .where(and(eq(jobOffers.isActive, true), isNotNull(jobOffers.siren)))
    .all()
    .filter((o) => sirens.has(o.siren as string) && !seen.has(o.id)).length;
}
```

`pipelineOverview(db, nowDate = new Date())` : remplacer `const now = Date.now();` par `const now = nowDate.getTime();`, puis après `runs` :

```ts
  const lastRefreshRow = db
    .select()
    .from(crawlRuns)
    .where(and(eq(crawlRuns.command, 'refresh'), isNotNull(crawlRuns.finishedAt)))
    .orderBy(desc(crawlRuns.id))
    .get();
  const lastRefresh: RunWithStatus | null = lastRefreshRow
    ? { ...lastRefreshRow, status: runStatus(lastRefreshRow, now) }
    : null;
  const refreshStale =
    !!lastRefresh?.finishedAt && now - Date.parse(lastRefresh.finishedAt) > REFRESH_STALE_AFTER_MS;
```

avec `const REFRESH_STALE_AFTER_MS = 12 * 60 * 60 * 1000;` près de `RUNNING_MAX_MS`, et retourner `{ runs, lastRefresh, refreshStale, counts: {…} }`.

- [ ] **Step 4 : Lancer tous les tests web**

Run: `pnpm --filter @novi/web exec vitest run`
Expected: PASS. Les tests existants de `data.test.ts` appellent `listCompanies(db, profile, filters)` sans `now` : le défaut couvre.

- [ ] **Step 5 : Lint, typecheck, commit**

```bash
pnpm lint && pnpm --filter @novi/web exec tsc --noEmit
git add apps/web
git commit -m "feat(web): offres récentes et non vues dans la liste, la fiche et le score ; dernier refresh

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3 : Mutations : identité, nouveautés, CV

**Files:**
- Modify: `apps/web/src/lib/mutations.ts`
- Test: `apps/web/test/mutations-v2.test.ts`

- [ ] **Step 1 : Écrire le test**

`apps/web/test/mutations-v2.test.ts` :

```ts
import { getDefaultProfile, profiles } from '@novi/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { applyCv, applyProfile } from '@/lib/mutations';
import { seededDb } from './helpers';

const baseInput = {
  homeLabel: 'Nice',
  homeLatitude: 43.7,
  homeLongitude: 7.26,
  radiusKm: 30,
  skills: ['react'],
  headcountRanges: ['12'],
};

describe('applyProfile V2', () => {
  it('stores identity fields trimmed, empty as null, and the new-offer window', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    applyProfile(db, id, {
      ...baseInput,
      firstName: ' Jean ',
      lastName: 'Dupont',
      email: '',
      phone: '06 12 34 56 78',
      postalAddress: '',
      links: [' https://github.com/jd ', '', 'linkedin.com/in/jd'],
      revealFirstName: true,
      newOfferDays: 14,
    });
    expect(getDefaultProfile(db)).toMatchObject({
      firstName: 'Jean',
      lastName: 'Dupont',
      email: null,
      phone: '06 12 34 56 78',
      postalAddress: null,
      links: ['https://github.com/jd', 'https://linkedin.com/in/jd'],
      revealFirstName: true,
      newOfferDays: 14,
    });
  });
  it('leaves V2 fields untouched when omitted', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    db.update(profiles).set({ lastName: 'Dupont', newOfferDays: 3 }).where(eq(profiles.id, id)).run();
    applyProfile(db, id, baseInput);
    expect(getDefaultProfile(db)).toMatchObject({ lastName: 'Dupont', newOfferDays: 3 });
  });
  it('validates the window, the email and the links', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    expect(() => applyProfile(db, id, { ...baseInput, newOfferDays: 0 })).toThrow(/entre 1 et 90/);
    expect(() => applyProfile(db, id, { ...baseInput, newOfferDays: 2.5 })).toThrow(/entre 1 et 90/);
    expect(() => applyProfile(db, id, { ...baseInput, email: 'pas-un-mail' })).toThrow(/e-mail/i);
    expect(() => applyProfile(db, id, { ...baseInput, links: ['pas une url'] })).toThrow(/lien/i);
  });
});

describe('applyCv', () => {
  it('stores the CV and fills only the blank identity fields', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    db.update(profiles).set({ email: 'deja@la.fr' }).where(eq(profiles.id, id)).run();
    applyCv(
      db,
      id,
      { filename: 'cv.pdf', text: 'Texte du CV', pages: 2 },
      { email: 'cv@mail.fr', phone: '06 00 00 00 00', links: ['https://github.com/x'], nameCandidates: [] },
    );
    const p = getDefaultProfile(db);
    expect(p).toMatchObject({
      cvFilename: 'cv.pdf',
      cvText: 'Texte du CV',
      cvPages: 2,
      email: 'deja@la.fr',
      phone: '06 00 00 00 00',
      links: ['https://github.com/x'],
    });
    expect(p.cvUploadedAt).toMatch(/^\d{4}-/);
  });
  it('replaces a previous CV', () => {
    const db = seededDb();
    const id = getDefaultProfile(db).id;
    const hints = { email: undefined, phone: undefined, links: [], nameCandidates: [] };
    applyCv(db, id, { filename: 'a.pdf', text: 'A', pages: 1 }, hints);
    applyCv(db, id, { filename: 'b.pdf', text: 'B', pages: 3 }, hints);
    expect(getDefaultProfile(db)).toMatchObject({ cvFilename: 'b.pdf', cvText: 'B', cvPages: 3 });
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `pnpm --filter @novi/web exec vitest run test/mutations-v2.test.ts`
Expected: FAIL.

- [ ] **Step 3 : Modifier `apps/web/src/lib/mutations.ts`**

Imports : ajouter `import type { IdentityHints } from '@novi/assist';` et `profiles` est déjà importé.

Remplacer `ProfileInput` et `applyProfile` :

```ts
export type ProfileInput = {
  homeLabel: string;
  homeLatitude: number;
  homeLongitude: number;
  radiusKm: number;
  skills: string[];
  headcountRanges: string[];
  // V2, facultatifs : absents, les colonnes correspondantes ne sont pas modifiées.
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  postalAddress?: string;
  links?: string[];
  revealFirstName?: boolean;
  newOfferDays?: number;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function nullable(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function normalizeLinks(links: string[]): string[] {
  return links
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const withScheme = /^https?:\/\//i.test(l) ? l : `https://${l}`;
      try {
        const url = new URL(withScheme);
        if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) throw new Error();
        return withScheme;
      } catch {
        throw new Error(`Lien invalide : ${l}`);
      }
    });
}

export function applyProfile(database: Db, profileId: number, input: ProfileInput): void {
  if (!(input.radiusKm >= 1 && input.radiusKm <= 200))
    throw new Error('Le rayon doit être entre 1 et 200 km');
  if (!input.homeLabel.trim()) throw new Error('Adresse manquante');
  if (!(Number.isFinite(input.homeLatitude) && Math.abs(input.homeLatitude) <= 90))
    throw new Error('Latitude invalide');
  if (!(Number.isFinite(input.homeLongitude) && Math.abs(input.homeLongitude) <= 180))
    throw new Error('Longitude invalide');
  if (input.newOfferDays !== undefined && !(Number.isInteger(input.newOfferDays) && input.newOfferDays >= 1 && input.newOfferDays <= 90))
    throw new Error('La fenêtre de nouveauté doit être un nombre entier de jours entre 1 et 90');
  const email = nullable(input.email);
  if (email && !EMAIL_RE.test(email)) throw new Error('Adresse e-mail invalide');
  const known = new Set(loadTechTags().map((t) => t.slug));
  const knownRanges = new Set(Object.keys(HEADCOUNT_LABELS));
  const set: Partial<typeof profiles.$inferInsert> = {
    homeLabel: input.homeLabel.trim(),
    homeLatitude: input.homeLatitude,
    homeLongitude: input.homeLongitude,
    radiusKm: input.radiusKm,
    skills: input.skills.filter((s) => known.has(s)),
    headcountRanges: input.headcountRanges.filter((r) => knownRanges.has(r)),
  };
  if (input.firstName !== undefined) set.firstName = nullable(input.firstName);
  if (input.lastName !== undefined) set.lastName = nullable(input.lastName);
  if (input.email !== undefined) set.email = email;
  if (input.phone !== undefined) set.phone = nullable(input.phone);
  if (input.postalAddress !== undefined) set.postalAddress = nullable(input.postalAddress);
  if (input.links !== undefined) set.links = normalizeLinks(input.links);
  if (input.revealFirstName !== undefined) set.revealFirstName = input.revealFirstName;
  if (input.newOfferDays !== undefined) set.newOfferDays = input.newOfferDays;
  database.update(profiles).set(set).where(eq(profiles.id, profileId)).run();
}

export type CvInput = { filename: string; text: string; pages: number };

/** Remplace le CV du profil et complète les champs d'identité encore vides avec les indices détectés. */
export function applyCv(database: Db, profileId: number, cv: CvInput, hints: IdentityHints): void {
  const current = database.select().from(profiles).where(eq(profiles.id, profileId)).get();
  if (!current) throw new Error('Profil introuvable');
  database
    .update(profiles)
    .set({
      cvFilename: cv.filename,
      cvText: cv.text,
      cvPages: cv.pages,
      cvUploadedAt: new Date().toISOString(),
      email: current.email ?? hints.email ?? null,
      phone: current.phone ?? hints.phone ?? null,
      links: current.links.length > 0 ? current.links : hints.links,
    })
    .where(eq(profiles.id, profileId))
    .run();
}
```

- [ ] **Step 4 : Lancer les tests web**

Run: `pnpm --filter @novi/web exec vitest run`
Expected: PASS (les anciens tests d'`applyProfile` passent sans les champs V2).

- [ ] **Step 5 : Lint, typecheck, commit**

```bash
pnpm lint && pnpm --filter @novi/web exec tsc --noEmit
git add apps/web
git commit -m "feat(web): identité, fenêtre de nouveauté et CV dans les mutations de profil

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4 : Génération de lettre testable (`lib/letters.ts`)

**Files:**
- Create: `apps/web/src/lib/letters.ts`
- Test: `apps/web/test/letters.test.ts`

- [ ] **Step 1 : Écrire le test**

`apps/web/test/letters.test.ts` :

```ts
import type { TextGenerator } from '@novi/assist';
import { coverLetters, getDefaultProfile, profiles } from '@novi/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { generateLetterFor } from '@/lib/letters';
import { seededDb } from './helpers';

function ready() {
  const db = seededDb();
  const id = getDefaultProfile(db).id;
  db.update(profiles)
    .set({
      firstName: 'Jean',
      lastName: 'Dupont',
      phone: '06 12 34 56 78',
      cvText: 'Jean Dupont\n06 12 34 56 78\nDéveloppeur React depuis 2020',
      skills: ['react'],
    })
    .where(eq(profiles.id, id))
    .run();
  return { db, profile: getDefaultProfile(db) };
}

function fakeGenerator(reply: string): TextGenerator & { generate: ReturnType<typeof vi.fn> } {
  return { label: 'fake/m', generate: vi.fn(async () => ({ text: reply, model: 'm-1' })) };
}

describe('generateLetterFor', () => {
  it('anonymises what is sent, restores the letter and stores it', async () => {
    const { db, profile } = ready();
    const gen = fakeGenerator('Madame, Monsieur,\n\nDéveloppeur React…\n\n[PRENOM] [NOM]\n[TELEPHONE]');
    const out = await generateLetterFor(db, profile, { siren: '000000001', offerId: 'A', instruction: 'Court' }, gen);
    const sent = gen.generate.mock.calls[0]?.[0] as { system: string; prompt: string };
    expect(sent.prompt).not.toContain('Dupont');
    expect(sent.prompt).not.toContain('06 12 34 56 78');
    expect(sent.prompt).toContain('[NOM]');
    expect(sent.prompt).toContain('Cliken Web');
    expect(sent.prompt).toContain('Dev React');
    expect(sent.prompt).toContain('Court');
    expect(out.letter.content).toBe('Madame, Monsieur,\n\nDéveloppeur React…\n\nJean Dupont\n06 12 34 56 78');
    expect(out.letter.model).toBe('fake/m');
    expect(out.letter.offerTitle).toBe('Dev React');
    expect(out.sentPrompt).toBe(sent.prompt);
    expect(db.select().from(coverLetters).all()).toHaveLength(1);
  });
  it('writes nothing when the generator fails', async () => {
    const { db, profile } = ready();
    const gen: TextGenerator = {
      label: 'fake/m',
      generate: async () => {
        throw new Error('quota');
      },
    };
    await expect(generateLetterFor(db, profile, { siren: '000000001' }, gen)).rejects.toThrow('quota');
    expect(db.select().from(coverLetters).all()).toHaveLength(0);
  });
  it('refuses without a CV, with an unknown company or a foreign offer', async () => {
    const { db, profile } = ready();
    const gen = fakeGenerator('x');
    db.update(profiles).set({ cvText: null }).where(eq(profiles.id, profile.id)).run();
    await expect(generateLetterFor(db, getDefaultProfile(db), { siren: '000000001' }, gen)).rejects.toThrow(/CV/);
    await expect(generateLetterFor(db, profile, { siren: '999' }, gen)).rejects.toThrow(/inconnue/);
    await expect(generateLetterFor(db, profile, { siren: '000000001', offerId: 'B' }, gen)).rejects.toThrow(/offre/i);
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `pnpm --filter @novi/web exec vitest run test/letters.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : Écrire `apps/web/src/lib/letters.ts`**

```ts
import { anonymize, buildLetterPrompt, type LetterInput, restore, type TextGenerator } from '@novi/assist';
import { loadTechTags } from '@novi/core';
import {
  type CoverLetterWithOffer,
  companies,
  companyTech,
  type Db,
  insertCoverLetter,
  jobOffers,
  type Profile,
} from '@novi/db';
import { and, eq } from 'drizzle-orm';
import { identityFromProfile } from './assist';
import { headcountLabel } from './format';

export type LetterRequest = { siren: string; offerId?: string | null; instruction?: string | null };
export type LetterOutcome = { letter: CoverLetterWithOffer; sentPrompt: string };

const MAX_TECHS_IN_PROMPT = 15;
const SOURCE_LABELS: Record<string, string> = { offre: 'offre', site: 'site', github: 'GitHub', manuel: 'manuel' };
const tagIndex = new Map(loadTechTags().map((t) => [t.slug, t]));

function companyTechsForPrompt(db: Db, siren: string): LetterInput['company']['techs'] {
  const best = new Map<string, { confidence: number; source: string }>();
  for (const r of db.select().from(companyTech).where(eq(companyTech.siren, siren)).all()) {
    const current = best.get(r.tagSlug);
    if (!current || r.confidence > current.confidence) best.set(r.tagSlug, { confidence: r.confidence, source: r.source });
  }
  return [...best.entries()]
    .sort((a, b) => b[1].confidence - a[1].confidence)
    .slice(0, MAX_TECHS_IN_PROMPT)
    .map(([slug, v]) => ({ label: tagIndex.get(slug)?.label ?? slug, source: SOURCE_LABELS[v.source] ?? v.source }));
}

export async function generateLetterFor(
  db: Db,
  profile: Profile,
  request: LetterRequest,
  generator: TextGenerator,
): Promise<LetterOutcome> {
  if (!profile.cvText) throw new Error('Importez votre CV dans le profil pour générer des lettres');
  const company = db.select().from(companies).where(eq(companies.siren, request.siren)).get();
  if (!company) throw new Error(`Entreprise inconnue : ${request.siren}`);
  const offer = request.offerId
    ? db
        .select()
        .from(jobOffers)
        .where(and(eq(jobOffers.id, request.offerId), eq(jobOffers.siren, request.siren)))
        .get()
    : undefined;
  if (request.offerId && !offer) throw new Error("Offre inconnue pour cette entreprise");
  const identity = identityFromProfile(profile);
  const mask = (text: string | null | undefined) => (text ? anonymize(text, identity) : null);
  const input: LetterInput = {
    profile: { homeLabel: profile.homeLabel, skills: profile.skills },
    cvText: anonymize(profile.cvText, identity),
    company: {
      name: company.name,
      city: company.city,
      headcountLabel: company.headcountRange ? headcountLabel(company.headcountRange) : null,
      description: company.description,
      techs: companyTechsForPrompt(db, company.siren),
      careersUrl: company.careersUrl,
      website: company.website,
    },
    offer: offer
      ? { title: offer.title, contractType: offer.contractType, description: mask(offer.description), city: offer.city }
      : undefined,
    instruction: mask(request.instruction) ?? undefined,
    revealFirstName: identity.revealFirstName,
  };
  const prompt = buildLetterPrompt(input);
  const { text } = await generator.generate(prompt);
  const content = restore(text, identity);
  const row = insertCoverLetter(db, {
    profileId: profile.id,
    siren: company.siren,
    offerId: offer?.id ?? null,
    instruction: request.instruction?.trim() || null,
    content,
    model: generator.label,
  });
  return {
    letter: {
      id: row.id,
      offerId: row.offerId,
      offerTitle: offer?.title ?? null,
      instruction: row.instruction,
      content: row.content,
      model: row.model,
      createdAt: row.createdAt,
    },
    sentPrompt: prompt.prompt,
  };
}
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `pnpm --filter @novi/web exec vitest run test/letters.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5 : Lint, typecheck, commit**

```bash
pnpm lint && pnpm --filter @novi/web exec tsc --noEmit
git add apps/web
git commit -m "feat(web): génération de lettre anonymisée puis restaurée, générateur injectable

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5 : Actions serveur `uploadCv`, `generateLetter`, `deleteLetter`

**Files:**
- Modify: `apps/web/src/app/actions.ts`

Pas de test unitaire direct (les actions sont des enveloppes : la logique est testée dans `mutations` et `letters`). Vérification par typecheck et, à la tâche 6, dans le navigateur.

- [ ] **Step 1 : Ajouter les imports**

```ts
import { analyzeCv, AssistError, createGenerator, detectIdentityHints, extractPdfText, LlmError, MAX_PDF_BYTES } from '@novi/assist';
import { loadTechTags } from '@novi/core';
import { type CoverLetterWithOffer, deleteCoverLetter } from '@novi/db';
import { generateLetterFor, type LetterRequest } from '@/lib/letters';
import { applyCv, … } from '@/lib/mutations';
```

(`…` : garder les imports existants.) Importer aussi `'@/lib/assist'` pour son effet de bord de chargement du `.env` : `import '@/lib/assist';`.

- [ ] **Step 2 : Ajouter les actions à la fin du fichier**

```ts
export type UploadCvResult =
  | {
      ok: true;
      filename: string;
      pages: number;
      uploadedAt: string;
      text: string;
      techs: { slug: string; label: string; inProfile: boolean }[];
      nameCandidates: string[];
      hints: { email?: string; phone?: string; links: string[] };
    }
  | { ok: false; error: string };

export async function uploadCv(formData: FormData): Promise<UploadCvResult> {
  try {
    const file = formData.get('file');
    if (!(file instanceof Blob) || !('name' in file)) return { ok: false, error: 'Aucun fichier reçu' };
    const named = file as File;
    if (named.type !== 'application/pdf' && !named.name.toLowerCase().endsWith('.pdf'))
      return { ok: false, error: new AssistError('cv_not_pdf').message };
    if (named.size > MAX_PDF_BYTES) return { ok: false, error: new AssistError('cv_too_large').message };
    const { text, pages } = await extractPdfText(new Uint8Array(await named.arrayBuffer()));
    const tags = loadTechTags();
    const hints = detectIdentityHints(text);
    const profile = getProfile();
    applyCv(db(), profile.id, { filename: named.name, text, pages }, hints);
    const skills = new Set(profile.skills);
    const labels = new Map(tags.map((t) => [t.slug, t.label]));
    const techs = [...new Set(analyzeCv(text, tags).techs.map((d) => d.slug))].map((slug) => ({
      slug,
      label: labels.get(slug) ?? slug,
      inProfile: skills.has(slug),
    }));
    revalidatePath('/profil');
    return {
      ok: true,
      filename: named.name,
      pages,
      uploadedAt: new Date().toISOString(),
      text,
      techs,
      nameCandidates: hints.nameCandidates,
      hints: { email: hints.email, phone: hints.phone, links: hints.links },
    };
  } catch (err) {
    return fail(err);
  }
}

export type GenerateLetterResult =
  | { ok: true; letter: CoverLetterWithOffer; sentPrompt: string }
  | { ok: false; error: string };

export async function generateLetter(request: LetterRequest): Promise<GenerateLetterResult> {
  try {
    const generator = createGenerator();
    if (!generator) return { ok: false, error: 'Aucun fournisseur LLM configuré (voir .env.example)' };
    const outcome = await generateLetterFor(db(), getProfile(), request, generator);
    revalidatePath(`/entreprises/${request.siren}`);
    return { ok: true, ...outcome };
  } catch (err) {
    if (err instanceof LlmError || err instanceof AssistError) return { ok: false, error: err.message };
    return fail(err);
  }
}

export async function deleteLetter(id: number, siren: string): Promise<ActionResult> {
  try {
    if (!deleteCoverLetter(db(), getProfile().id, id)) return { ok: false, error: 'Lettre introuvable' };
    revalidatePath(`/entreprises/${siren}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
```

- [ ] **Step 3 : Typecheck, lint, commit**

```bash
pnpm lint && pnpm --filter @novi/web exec tsc --noEmit
git add apps/web
git commit -m "feat(web): actions serveur d'import de CV et de lettres

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6 : Page profil : CV, identité, nouveautés

**Files:**
- Create: `apps/web/src/components/cv-section.tsx`
- Modify: `apps/web/src/components/profile-form.tsx`
- Modify: `apps/web/src/app/profil/page.tsx`

- [ ] **Step 1 : Écrire `apps/web/src/components/cv-section.tsx`**

```tsx
'use client';

import { useRef, useState, useTransition } from 'react';
import { type UploadCvResult, uploadCv } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';

export type CvInfo = { filename: string; pages: number; uploadedAt: string; text: string } | null;
export type CvTech = { slug: string; label: string; inProfile: boolean };

export function CvSection({
  cv,
  techs,
  skills,
  onAddSkills,
  onImported,
}: {
  cv: CvInfo;
  techs: CvTech[];
  skills: string[];
  onAddSkills: (slugs: string[]) => void;
  onImported: (result: Extract<UploadCvResult, { ok: true }>) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const inProfile = techs.filter((t) => skills.includes(t.slug));
  const missing = techs.filter((t) => !skills.includes(t.slug));

  return (
    <section className="space-y-2">
      <h2 className="font-medium">CV</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileInput} type="file" accept="application/pdf,.pdf" className="text-sm" />
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            const file = fileInput.current?.files?.[0];
            if (!file) {
              setError('Choisissez un fichier PDF');
              return;
            }
            const data = new FormData();
            data.set('file', file);
            start(async () => {
              const r = await uploadCv(data);
              if (r.ok) {
                setError(null);
                onImported(r);
              } else setError(r.error);
            });
          }}
        >
          {pending ? 'Import…' : 'Importer'}
        </Button>
        {cv && (
          <span className="text-sm text-muted-foreground">
            {cv.filename} · {cv.pages} page{cv.pages > 1 ? 's' : ''} · importé le {formatDate(cv.uploadedAt)}
          </span>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {cv && (
        <div className="space-y-2 text-sm">
          {inProfile.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Déjà dans le profil</p>
              <div className="flex flex-wrap gap-1">
                {inProfile.map((t) => (
                  <span key={t.slug} className="rounded-full border px-2 py-0.5 text-muted-foreground">
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Détectées dans le CV, absentes du profil ({missing.length})
            </p>
            {missing.length === 0 ? (
              <p className="text-muted-foreground">Rien à ajouter.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-1">
                {missing.map((t) => (
                  <button
                    type="button"
                    key={t.slug}
                    onClick={() => onAddSkills([t.slug])}
                    className="rounded-full border border-foreground px-2 py-0.5"
                    title="Ajouter au profil"
                  >
                    {t.label}
                  </button>
                ))}
                <Button type="button" size="sm" variant="outline" onClick={() => onAddSkills(missing.map((t) => t.slug))}>
                  Tout ajouter au profil
                </Button>
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Les ajouts ne sont enregistrés qu'avec « Enregistrer le profil ».
            </p>
          </div>
          <details>
            <summary className="cursor-pointer text-muted-foreground">Voir le texte extrait</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{cv.text}</pre>
          </details>
        </div>
      )}
      {!cv && (
        <p className="text-sm text-muted-foreground">
          PDF texte uniquement (pas de scan), 10 pages et 5 Mo au plus. Seul le texte extrait est conservé.
        </p>
      )}
    </section>
  );
}
```

Vérifier que `Button` accepte `size="sm"` dans `components/ui/button.tsx` (shadcn : oui). Sinon retirer la prop.

- [ ] **Step 2 : Étendre `apps/web/src/components/profile-form.tsx`**

Modifier le type `Initial` et l'état :

```tsx
import { type CvInfo, type CvTech, CvSection } from '@/components/cv-section';

type Initial = {
  homeLabel: string;
  homeLatitude: number;
  homeLongitude: number;
  radiusKm: number;
  skills: string[];
  headcountRanges: string[];
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  postalAddress: string;
  links: string[];
  revealFirstName: boolean;
  newOfferDays: number;
  cv: CvInfo;
  cvTechs: CvTech[];
  nameCandidates: string[];
};
```

Dans le composant, après `const [ranges, …]` :

```tsx
  const [identity, setIdentity] = useState({
    firstName: initial.firstName,
    lastName: initial.lastName,
    email: initial.email,
    phone: initial.phone,
    postalAddress: initial.postalAddress,
    links: initial.links.join('\n'),
    revealFirstName: initial.revealFirstName,
  });
  const [newOfferDays, setNewOfferDays] = useState(initial.newOfferDays);
  const [cv, setCv] = useState<CvInfo>(initial.cv);
  const [cvTechs, setCvTechs] = useState<CvTech[]>(initial.cvTechs);
  const [nameCandidates, setNameCandidates] = useState(initial.nameCandidates);
  const setField = (key: keyof typeof identity, value: string | boolean) =>
    setIdentity((prev) => ({ ...prev, [key]: value }));
```

Dans l'appel `updateProfile({...})` du `onSubmit`, ajouter :

```tsx
            firstName: identity.firstName,
            lastName: identity.lastName,
            email: identity.email,
            phone: identity.phone,
            postalAddress: identity.postalAddress,
            links: identity.links.split('\n'),
            revealFirstName: identity.revealFirstName,
            newOfferDays,
```

Insérer, tout en haut du `<form>`, avant la section « Point de départ » :

```tsx
      <CvSection
        cv={cv}
        techs={cvTechs}
        skills={skills}
        onAddSkills={(slugs) => setSkills((prev) => [...prev, ...slugs.filter((s) => !prev.includes(s))])}
        onImported={(r) => {
          setCv({ filename: r.filename, pages: r.pages, uploadedAt: r.uploadedAt, text: r.text });
          setCvTechs(r.techs);
          setNameCandidates(r.nameCandidates);
          setIdentity((prev) => ({
            ...prev,
            email: prev.email || r.hints.email || '',
            phone: prev.phone || r.hints.phone || '',
            links: prev.links || r.hints.links.join('\n'),
          }));
          setMessage({ kind: 'ok', text: `CV importé : ${r.techs.length} technos détectées` });
        }}
      />

      <section className="space-y-2">
        <h2 className="font-medium">Identité</h2>
        <p className="text-sm text-muted-foreground">
          Ces valeurs ne quittent jamais votre machine : elles servent à les masquer dans ce qui est envoyé au
          LLM, puis à les rétablir dans la lettre.
        </p>
        {nameCandidates.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <span className="text-muted-foreground">Nom lu dans le CV :</span>
            {nameCandidates.map((c) => (
              <button
                type="button"
                key={c}
                className="rounded-full border px-2 py-0.5"
                onClick={() => {
                  const [first, ...rest] = c.split(/\s+/);
                  setField('firstName', first ?? '');
                  setField('lastName', rest.join(' '));
                }}
              >
                Utiliser : {c}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="Prénom" value={identity.firstName} onChange={(e) => setField('firstName', e.target.value)} />
          <Input placeholder="Nom" value={identity.lastName} onChange={(e) => setField('lastName', e.target.value)} />
          <Input placeholder="E-mail" type="email" value={identity.email} onChange={(e) => setField('email', e.target.value)} />
          <Input placeholder="Téléphone" value={identity.phone} onChange={(e) => setField('phone', e.target.value)} />
          <Input
            placeholder="Adresse postale"
            className="sm:col-span-2"
            value={identity.postalAddress}
            onChange={(e) => setField('postalAddress', e.target.value)}
          />
          <textarea
            className="min-h-16 rounded-md border bg-background px-3 py-2 text-sm sm:col-span-2"
            placeholder={'Liens (un par ligne) : LinkedIn, GitHub, site perso'}
            value={identity.links}
            onChange={(e) => setField('links', e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={identity.revealFirstName}
            onChange={(e) => setField('revealFirstName', e.target.checked)}
          />
          Laisser passer mon prénom au LLM (lettre au ton plus naturel)
        </label>
      </section>
```

Et après la section « Tailles d'entreprise souhaitées », insérer :

```tsx
      <section className="space-y-2">
        <h2 className="font-medium">Nouveautés</h2>
        <label htmlFor="new-offer-days" className="flex items-center gap-2 text-sm">
          Considérer une offre comme nouvelle pendant
          <Input
            id="new-offer-days"
            type="number"
            min={1}
            max={90}
            value={newOfferDays}
            onChange={(e) => setNewOfferDays(Number(e.target.value))}
            className="w-20"
          />
          jours
        </label>
      </section>
```

- [ ] **Step 3 : Modifier `apps/web/src/app/profil/page.tsx`**

```tsx
import { analyzeCv, detectIdentityHints } from '@novi/assist';
import { loadTechTags } from '@novi/core';
import { ProfileForm } from '@/components/profile-form';
import { getProfile } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function ProfilePage() {
  const p = getProfile();
  const allTags = loadTechTags();
  const tags = allTags.map((t) => ({ slug: t.slug, label: t.label, category: t.category }));
  const labels = new Map(allTags.map((t) => [t.slug, t.label]));
  const skills = new Set(p.skills);
  const cvTechs = p.cvText
    ? [...new Set(analyzeCv(p.cvText, allTags).techs.map((d) => d.slug))].map((slug) => ({
        slug,
        label: labels.get(slug) ?? slug,
        inProfile: skills.has(slug),
      }))
    : [];
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Profil</h1>
      <ProfileForm
        initial={{
          homeLabel: p.homeLabel,
          homeLatitude: p.homeLatitude,
          homeLongitude: p.homeLongitude,
          radiusKm: p.radiusKm,
          skills: p.skills,
          headcountRanges: p.headcountRanges,
          firstName: p.firstName ?? '',
          lastName: p.lastName ?? '',
          email: p.email ?? '',
          phone: p.phone ?? '',
          postalAddress: p.postalAddress ?? '',
          links: p.links,
          revealFirstName: p.revealFirstName,
          newOfferDays: p.newOfferDays,
          cv:
            p.cvText && p.cvFilename
              ? { filename: p.cvFilename, pages: p.cvPages ?? 0, uploadedAt: p.cvUploadedAt ?? '', text: p.cvText }
              : null,
          cvTechs,
          nameCandidates: p.cvText && !p.lastName ? detectIdentityHints(p.cvText).nameCandidates : [],
        }}
        tags={tags}
      />
    </div>
  );
}
```

- [ ] **Step 4 : Vérifier dans le navigateur**

Si `pnpm dev` ne tourne pas, le lancer dans une fenêtre séparée. Ouvrir http://localhost:3000/profil : la section CV apparaît en tête, l'import d'un PDF texte affiche les technos et pré-remplit e-mail / téléphone, « Tout ajouter au profil » coche les puces, « Enregistrer le profil » persiste identité et nouveautés (recharger pour vérifier). Un fichier non PDF affiche « Ce fichier n'est pas un PDF ».

- [ ] **Step 5 : Lint, typecheck, build, commit**

```bash
pnpm lint && pnpm --filter @novi/web exec tsc --noEmit && pnpm build
git add apps/web
git commit -m "feat(web): import du CV, identité et fenêtre de nouveauté sur la page profil

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7 : Fiche entreprise : badges d'offres et panneau lettres

**Files:**
- Create: `apps/web/src/components/letter-panel.tsx`
- Modify: `apps/web/src/app/entreprises/[siren]/page.tsx`

- [ ] **Step 1 : Écrire `apps/web/src/components/letter-panel.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { deleteLetter, generateLetter } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatDate } from '@/lib/format';

export type LetterSummary = {
  id: number;
  offerId: string | null;
  offerTitle: string | null;
  instruction: string | null;
  content: string;
  model: string;
  createdAt: string;
};

export type LetterAvailability = { ok: true; label: string } | { ok: false; reason: string; href?: string };

type Target = { offerId: string | null; title: string };

export function LetterPanel({
  siren,
  offers,
  letters,
  availability,
}: {
  siren: string;
  offers: { id: string; title: string }[];
  letters: LetterSummary[];
  availability: LetterAvailability;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState<{ letter: LetterSummary; sentPrompt: string } | null>(null);
  const [content, setContent] = useState('');
  const [history, setHistory] = useState(letters);
  const [showPrompt, setShowPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  if (!availability.ok) {
    return (
      <p className="text-sm text-muted-foreground">
        {availability.reason}
        {availability.href && (
          <>
            {' '}
            <Link href={availability.href} className="underline">
              Ouvrir le profil
            </Link>
          </>
        )}
      </p>
    );
  }

  const run = () => {
    if (!target) return;
    setError(null);
    start(async () => {
      const r = await generateLetter({ siren, offerId: target.offerId, instruction });
      if (r.ok) {
        setResult({ letter: r.letter, sentPrompt: r.sentPrompt });
        setContent(r.letter.content);
        setHistory((h) => [r.letter, ...h]);
      } else setError(r.error);
    });
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copie impossible : sélectionnez le texte à la main');
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={target && !target.offerId ? 'default' : 'outline'} size="sm" onClick={() => setTarget({ offerId: null, title: 'Candidature spontanée' })}>
          Lettre spontanée
        </Button>
        {offers.map((o) => (
          <Button
            type="button"
            key={o.id}
            variant={target?.offerId === o.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTarget({ offerId: o.id, title: o.title })}
            title={o.title}
          >
            Lettre : {o.title.length > 40 ? `${o.title.slice(0, 40)}…` : o.title}
          </Button>
        ))}
      </div>
      {target && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="font-medium">{target.title}</p>
          <Textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            placeholder="Consigne facultative : « Insister sur mon expérience Rust, ton sobre »"
          />
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={run}>
              {pending ? 'Génération…' : result ? 'Régénérer' : 'Générer'}
            </Button>
            <span className="text-xs text-muted-foreground">via {availability.label}, 5 à 20 s</span>
          </div>
          {error && <p className="text-destructive">{error}</p>}
          {result && (
            <div className="space-y-2">
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={18} />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => copy(content)}>
                  {copied ? 'Copié' : 'Copier'}
                </Button>
                <button type="button" className="text-xs underline" onClick={() => setShowPrompt((v) => !v)}>
                  {showPrompt ? 'Masquer ce qui a été envoyé' : 'Voir ce qui a été envoyé'}
                </button>
                <span className="text-xs text-muted-foreground">Généré avec {result.letter.model}</span>
              </div>
              {showPrompt && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{result.sentPrompt}</pre>
              )}
            </div>
          )}
        </div>
      )}
      {history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">Lettres générées ({history.length})</summary>
          <ul className="mt-2 space-y-2">
            {history.map((l) => (
              <li key={l.id} className="rounded-md border p-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {formatDate(l.createdAt)} · {l.offerTitle ?? 'spontanée'} · {l.model}
                  </span>
                  <span className="flex gap-2">
                    <button type="button" className="underline" onClick={() => copy(l.content)}>
                      Copier
                    </button>
                    <button
                      type="button"
                      className="underline"
                      onClick={() =>
                        start(async () => {
                          const r = await deleteLetter(l.id, siren);
                          if (r.ok) setHistory((h) => h.filter((x) => x.id !== l.id));
                          else setError(r.error);
                        })
                      }
                    >
                      Supprimer
                    </button>
                  </span>
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs">Lire</summary>
                  <pre className="mt-1 whitespace-pre-wrap text-xs">{l.content}</pre>
                </details>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 2 : Modifier la fiche `apps/web/src/app/entreprises/[siren]/page.tsx`**

Imports à ajouter :

```tsx
import { LetterPanel } from '@/components/letter-panel';
import { Badge } from '@/components/ui/badge';
import { llmStatus } from '@/lib/assist';
```

Remplacer l'appel au détail :

```tsx
  const detail = getCompanyDetail(db(), profile, siren, { markSeen: true });
  if (!detail) notFound();
  const { company, distanceKm, techGroups, activeOffers, signals, score, status, notes, links, letters } = detail;
  const llm = llmStatus();
  const availability = !llm.configured
    ? { ok: false as const, reason: llm.problem ?? 'Aucun fournisseur LLM configuré : renseigner LLM_PROVIDER dans .env (voir README).' }
    : !profile.cvText
      ? { ok: false as const, reason: 'Importez votre CV dans le profil pour générer des lettres.', href: '/profil' }
      : { ok: true as const, label: llm.label };
```

Dans la section « Offres actives », remplacer le `<li>` :

```tsx
                {activeOffers.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-2">
                    {o.unseen && (
                      <span className="inline-block size-2 rounded-full bg-orange-600" title="Première fois affichée" />
                    )}
                    {o.url ? <External href={o.url}>{o.title}</External> : o.title}
                    {o.isRecent && (
                      <Badge variant="outline" className="border-orange-600 text-orange-700">
                        Nouveau
                      </Badge>
                    )}
                    <span className="text-muted-foreground">
                      · {o.contractType ?? '—'} · {formatDate(o.publishedAt)}
                    </span>
                  </li>
                ))}
```

Après la section « Offres actives », ajouter :

```tsx
          <Section title="Lettre de motivation">
            <LetterPanel
              siren={company.siren}
              offers={activeOffers.map((o) => ({ id: o.id, title: o.title }))}
              letters={letters}
              availability={availability}
            />
          </Section>
```

- [ ] **Step 3 : Vérifier dans le navigateur**

Ouvrir la fiche de CLEEVEN SE (19 offres). Sans `LLM_PROVIDER` dans `.env`, le panneau affiche la phrase grise. Avec la configuration Gemini et un CV importé : « Lettre spontanée » puis « Générer » produit une lettre en 5 à 20 s, « Voir ce qui a été envoyé » ne contient ni nom ni téléphone, « Copier » fonctionne, la lettre apparaît dans « Lettres générées » après rechargement. Les offres récentes portent « Nouveau » et le point orange disparaît au rechargement.

- [ ] **Step 4 : Lint, typecheck, commit**

```bash
pnpm lint && pnpm --filter @novi/web exec tsc --noEmit
git add apps/web
git commit -m "feat(web): lettres de motivation et badges d'offres sur la fiche entreprise

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8 : Exploration : marqueurs, badge, filtre, bandeau

**Files:**
- Modify: `apps/web/src/components/company-map.tsx`
- Modify: `apps/web/src/components/company-list.tsx`
- Modify: `apps/web/src/components/filters.tsx`
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1 : Couleurs et légende de la carte**

Dans `company-map.tsx`, remplacer la ligne de couleur du point :

```ts
      dot.style.background = c.recentOffers > 0 ? '#ea580c' : c.recruiting ? '#16a34a' : '#2563eb';
      if (c.recentOffers > 0) dot.style.boxShadow = '0 0 0 1px rgba(0,0,0,.3), 0 0 0 5px rgba(234,88,12,.25)';
```

et le `title` : `` el.title = `${c.name} · score ${c.score}${c.recentOffers > 0 ? ` · ${c.recentOffers} nouvelle(s) offre(s)` : ''}`; ``

Remplacer le `return` du composant :

```tsx
  return (
    <div className="space-y-1">
      <div ref={container} className="h-[420px] w-full rounded-lg border lg:h-[calc(100vh-10rem)]" />
      <p className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-full bg-[#ea580c]" /> nouvelles offres
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-full bg-[#16a34a]" /> recrute
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-full bg-[#2563eb]" /> autre
        </span>
      </p>
    </div>
  );
```

- [ ] **Step 2 : Badge dans la liste**

Dans `company-list.tsx`, importer `Badge` depuis `@/components/ui/badge` et, avant `{c.recruiting && …}` :

```tsx
                {c.recentOffers > 0 && (
                  <Badge variant="outline" className="border-orange-600 text-orange-700">
                    Nouveau ×{c.recentOffers}
                  </Badge>
                )}
```

- [ ] **Step 3 : Filtre « Nouvelles offres »**

Dans `filters.tsx`, après la case « Recrute actuellement » :

```tsx
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={filters.nouvelles}
            onChange={(e) => update({ nouvelles: e.target.checked ? '1' : null })}
          />
          Nouvelles offres
        </label>
```

- [ ] **Step 4 : Bandeau sur la page d'accueil**

Dans `app/page.tsx`, importer `countUnseenOffersInRadius` et `Link` de `next/link`, calculer `const unseen = noData ? 0 : countUnseenOffersInRadius(db(), profile);` et, juste avant `<Suspense>` dans la branche non vide :

```tsx
          {unseen > 0 && (
            <p className="rounded-md border border-orange-600/40 bg-orange-50 px-3 py-2 text-sm dark:bg-orange-950/30">
              {unseen} offre{unseen > 1 ? 's' : ''} jamais consultée{unseen > 1 ? 's' : ''} dans votre rayon.{' '}
              <Link href="/?nouvelles=1" className="underline">
                Voir les nouvelles offres
              </Link>
            </p>
          )}
```

- [ ] **Step 5 : Vérifier dans le navigateur**

Sur `/` : les entreprises avec offres récentes sont orange avec halo, la légende est sous la carte, le badge « Nouveau ×N » apparaît dans la liste, la case « Nouvelles offres » met `?nouvelles=1` dans l'URL et filtre. Le bandeau indique le nombre d'offres jamais consultées et diminue après ouverture d'une fiche.

- [ ] **Step 6 : Lint, typecheck, commit**

```bash
pnpm lint && pnpm --filter @novi/web exec tsc --noEmit
git add apps/web
git commit -m "feat(web): nouvelles offres sur la carte, la liste, les filtres et un bandeau

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9 : Page pipeline : dernier refresh

**Files:**
- Modify: `apps/web/src/app/pipeline/page.tsx`

- [ ] **Step 1 : Afficher le dernier refresh**

Remplacer `const { runs, counts } = pipelineOverview(db());` par `const { runs, counts, lastRefresh, refreshStale } = pipelineOverview(db());` et insérer après le `<h1>` :

```tsx
      <div className="rounded-lg border p-3 text-sm">
        {lastRefresh ? (
          <p>
            Dernier refresh : {formatDate(lastRefresh.finishedAt)}
            {lastRefresh.stats ? ` (${lastRefresh.stats.newOffers ?? 0} nouvelle(s) offre(s), ${lastRefresh.stats.linked ?? 0} rattachée(s))` : ''}
            {refreshStale && (
              <span className="ml-2 text-destructive">
                Le rafraîchissement automatique semble arrêté : relancer `pwsh scripts/install-refresh-task.ps1`.
              </span>
            )}
          </p>
        ) : (
          <p className="text-muted-foreground">
            Aucun refresh automatique enregistré. Installer la tâche planifiée : `pwsh scripts/install-refresh-task.ps1`.
          </p>
        )}
      </div>
```

- [ ] **Step 2 : Lint, typecheck, commit**

```bash
pnpm lint && pnpm --filter @novi/web exec tsc --noEmit
git add apps/web
git commit -m "feat(web): état du dernier refresh sur la page pipeline

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10 : README, vérification finale, fusion

**Files:**
- Modify: `README.md`

- [ ] **Step 1 : README**

Dans la description des routes web, ajouter : « `/profil` : CV (PDF), identité masquée dans les envois au LLM, fenêtre de nouveauté ; `/entreprises/[siren]` : lettres de motivation (spontanée ou par offre) si `LLM_PROVIDER` est configuré et un CV importé ; `/` : marqueurs orange et filtre « Nouvelles offres ». »

Ajouter une courte section « Confidentialité » : « Le texte du CV, la fiche entreprise et l'offre sont envoyés au fournisseur LLM configuré. Nom, prénom, e-mail, téléphone, adresse et liens déclarés dans le profil sont remplacés par des jetons avant envoi et rétablis localement dans la lettre. « Voir ce qui a été envoyé » sur la fiche montre exactement le texte transmis. »

- [ ] **Step 2 : Suite complète et build**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: tout vert.

- [ ] **Step 3 : Commit et fusion**

```bash
git add README.md
git commit -m "docs: routes V2, confidentialité des lettres

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git checkout master
git merge --ff-only plan-4-web
```

Ne pas pousser sur `origin` sans demande explicite.

---

## Auto-revue du plan

- **Couverture du spec** : §7.1 → Tâches 3, 5, 6 ; §7.2 → Tâches 2, 4, 5, 7 ; §7.3 → Tâches 2, 8 ; §7.4 → Tâches 2, 9 ; §8 erreurs → `uploadCv`/`generateLetter` renvoient les messages `AssistError`/`LlmError`, échec LLM sans écriture (test Tâche 4), marquage des vues tolérant (Tâche 2) ; §9 tests → Tâches 1–4 ; §10 → Tâche 10.
- **Cohérence des types** : `CoverLetterWithOffer` (db) est le type des lettres partout, y compris `LetterSummary` côté client qui en est la copie structurelle (un composant client ne peut pas importer `@novi/db`). `GeneratorStatus` vient de `@novi/assist` via `llmStatus()`. `IdentityHints` vient de `@novi/assist` (`detectIdentityHints`). `listCompanies(db, profile, filters, now?)`, `getCompanyDetail(db, profile, siren, { markSeen?, now? })`, `pipelineOverview(db, now?)` sont les signatures utilisées dans les tests et les pages.
- **Hors périmètre respecté** : pas de streaming, pas d'export, un seul CV.
