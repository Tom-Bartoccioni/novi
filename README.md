# Novi

Découverte de startups et PME tech autour de chez soi. Le concept est dans `Concept.md`, le design dans `docs/superpowers/specs/`.

## Prérequis

- Node 22 ou plus récent, pnpm 9.
- Un compte développeur gratuit sur https://francetravail.io avec l'API « Offres d'emploi v2 » activée (facultatif : sans lui, les étapes offres sont ignorées).
- Un token GitHub personnel sans permission particulière (facultatif : passe de 60 à 5000 requêtes par heure).
- Aucun compilateur C++ : `better-sqlite3` est listé dans `pnpm.neverBuiltDependencies` du `package.json` racine pour que pnpm utilise ses binaires précompilés au lieu de tenter une compilation qui échouerait sans Visual Studio.

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
