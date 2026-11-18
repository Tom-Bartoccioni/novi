# Novi

Découverte de startups et PME tech autour de chez soi. Le concept est dans `Concept.md`, le design dans `docs/superpowers/specs/`.

## Démo

https://github.com/user-attachments/assets/cf646f57-fd78-41ad-b5f2-afbca1f3dc3b

## Prérequis

- Node 22 ou plus récent, pnpm 9.
- Un compte développeur gratuit sur https://francetravail.io avec l'API « Offres d'emploi » activée (l'ancienne « Offres d'emploi v2 », renommée sur le portail) (facultatif : sans lui, les étapes offres sont ignorées).
- Un token GitHub personnel sans permission particulière (facultatif : passe de 60 à 5000 requêtes par heure).
- Facultatif : une clé d'un fournisseur LLM à palier gratuit (Google AI Studio pour Gemini, Groq ou Mistral) pour générer des lettres de motivation ; voir `.env.example`.
- Aucun compilateur C++ : `better-sqlite3` est listé dans `pnpm.neverBuiltDependencies` du `package.json` racine pour que pnpm utilise ses binaires précompilés au lieu de tenter une compilation qui échouerait sans Visual Studio.

## Mise en route

```bash
cp .env.example .env      # puis renseigner les identifiants
pnpm install
pnpm db:migrate           # crée data/novi.db, charge le dictionnaire des technos et le profil par défaut
pnpm pipeline run all --departement 06
pnpm dev                  # puis http://localhost:3000
```

Pour générer des lettres, importer le CV et renseigner prénom et nom sur `/profil`. Redémarrer `pnpm dev` après toute modification de `.env` : il n'est lu qu'au démarrage.

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
| `pnpm pipeline refresh -d 06` | Offres France Travail, rattachement, signaux, puis résumé « N nouvelles offres ». Conçu pour la planification. |

Options par commande :

| Commande | Options |
|---|---|
| `ingest sirene`, `ingest offres` | `-d, --departement <code>` (défaut `06`), `--limit N` |
| `match offres` | `--force` : retraite aussi les offres déjà rattachées, ne détache jamais |
| `discover websites` | `--limit N`, `--siren X`, `--concurrency N` (défaut 5), `--force` : refait les sites trouvés automatiquement, jamais ceux renseignés manuellement |
| `crawl websites` | `--limit N`, `--siren X`, `--concurrency N` (défaut 5), `--force` : réanalyse même si le site a été crawlé il y a moins de 30 jours |
| `enrich github` | `--limit N`, `--siren X` |
| `run all` | `-d, --departement <code>` (défaut `06`) ; une étape en échec n'arrête pas les suivantes et le code de sortie vaut 1 |
| `refresh` | `-d, --departement <code>` (défaut `06`) ; code de sortie 1 sans identifiants France Travail ou si une étape échoue |

Chaque run est journalisé dans la table `crawl_runs`.

## Rafraîchissement automatique

Sous Windows, une tâche planifiée lance `pnpm pipeline refresh` toutes les 6 heures (modifiable) :

```powershell
pwsh scripts/install-refresh-task.ps1            # toutes les 6 h
pwsh scripts/install-refresh-task.ps1 -IntervalHours 3
pwsh scripts/uninstall-refresh-task.ps1
```

Le journal est dans `data/logs/refresh.log`. La page `/pipeline` affiche la date du dernier refresh et prévient s'il date de plus de 12 h.

Sous macOS ou Linux, l'équivalent `cron` (après `mkdir -p data/logs`) : `0 */6 * * * cd /chemin/vers/Novi && pnpm pipeline refresh -d 06 >> data/logs/refresh.log 2>&1`.

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
- `packages/assist` : extraction du CV (PDF), anonymisation réversible, adaptateurs LLM et prompt de lettre. Aucune dépendance à la base.
- `packages/pipeline` : ligne de commande d'ingestion.
- `apps/web` : application Next.js. `pnpm dev` puis http://localhost:3000. Le worker de MapLibre est copié dans `public/maplibre/` (ignoré par git) par `scripts/copy-maplibre-worker.mjs` avant `dev` et `build`, parce que Turbopack ne sait pas le résoudre depuis le chunk.
  - `/` exploration : liste et carte, filtres dans l'URL. Marqueurs orange et badge « Nouveau » pour les entreprises aux offres récentes, filtres « Nouvelles offres » et « Offres jamais consultées », bandeau du nombre d'offres jamais consultées dans le rayon.
  - `/entreprises/<siren>` fiche : identité, présence en ligne (avec « Analyser le site »), stack sourcée, offres, signaux, score expliqué, statut et notes. Lettres de motivation (spontanée ou par offre) si `LLM_PROVIDER` est configuré et un CV importé.
- `/lettres/<id>` : page d'impression d'une lettre (le navigateur propose « Enregistrer au format PDF ») ; `/lettres/<id>/docx` télécharge la lettre en Word (« Lettre - Nom Entreprise.docx »). Depuis la fiche, « Enregistrer les modifications » conserve ta relecture avant l'export.
  - `/employeurs-inconnus` : offres non rattachées, rattachement manuel mémorisé.
  - `/profil` : adresse géocodée, rayon, tailles, compétences, fenêtre de nouveauté des offres. CV (PDF) et identité masquée dans les envois au LLM.
  - `/pipeline` : compteurs, dernier refresh automatique et derniers runs.

## Confidentialité

Le texte du CV, la fiche entreprise et l'offre sont envoyés au fournisseur LLM configuré. Nom, prénom, e-mail, téléphone, adresse et liens déclarés dans le profil sont remplacés par des jetons avant envoi et rétablis localement dans la lettre (le prénom passe en clair si la case « Laisser passer mon prénom au LLM » est cochée dans le profil). « Voir ce qui a été envoyé » sur la fiche montre exactement le texte transmis, à l'exception du prompt système : un texte fixe de consignes de rédaction, sans aucune donnée du profil (`packages/assist/src/letter.ts`).
