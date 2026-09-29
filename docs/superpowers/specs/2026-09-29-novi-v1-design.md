# Novi V1 : découverte d'entreprises tech autour de soi

Date : 2026-09-29
Statut : validé en brainstorming, en attente de relecture avant plan d'implémentation.

## 1. Contexte et objectif

Novi inverse la recherche d'emploi classique. Au lieu de partir des offres publiées, l'utilisateur part de son profil (localisation, rayon, compétences, taille d'entreprise souhaitée) et découvre les startups et PME tech autour de lui, qu'elles recrutent ou non. La cible V1 est un développeur utilisant des technologies récentes, peu représentées dans les ESN et les grandes entreprises.

Le concept d'origine est décrit dans `Concept.md` à la racine du projet.

### Décisions prises pendant le cadrage

| Sujet | Décision |
|---|---|
| Utilisateurs | Mono-utilisateur en V1, mais modèle de données prêt pour le multi-utilisateurs (profil et statuts en tables séparées avec clé étrangère). |
| Coût | 100 % gratuit. Aucun appel LLM, aucune API payante. |
| Domaine | Modèle générique (compétences et technos sont des tags), mais pipeline de détection limité à la tech. |
| Zone de test | Département 06 (Alpes-Maritimes) pour l'ingestion, Nice comme point de départ, rayon 30 km. Tout est paramétrable. |
| Base | SQLite avec Drizzle ORM. PostGIS prévu plus tard : le calcul géographique est isolé dans un seul module. |
| Front | Next.js (App Router), Tailwind, shadcn/ui, MapLibre GL avec tuiles OpenFreeMap. |
| Priorité produit | La fiche entreprise est l'écran le plus important. |

### Hors périmètre V1

Enrichissement par LLM, comptes multi-utilisateurs, notifications, génération de candidature, suivi détaillé des échanges, tests end-to-end, hébergement.

## 2. Architecture

Monorepo pnpm, TypeScript partout, Node 22 LTS.

```
novi/
  apps/web/            Next.js, App Router, lit la base via Drizzle
  packages/core/       dictionnaire des technos, scoring, normalisation, types, config
  packages/db/         schéma Drizzle, client SQLite, migrations, module géographique
  packages/pipeline/   ligne de commande d'ingestion, une commande par étape
  docs/superpowers/    specs et plans
```

Dépendances autorisées : `core` ne dépend de rien. `db` dépend de `core`. `pipeline` et `web` dépendent de `core` et `db`. `web` peut importer des fonctions de `pipeline` pour le crawl d'une entreprise à la demande.

Outils : Biome (lint et format), Vitest (tests), Zod (validation des réponses d'API et de la config).

### Module géographique

`packages/db/src/geo.ts` expose une seule fonction : entreprises dans un rayon donné autour d'un point. En V1 elle calcule la distance haversine en SQL sur les colonnes `latitude` et `longitude`. Le jour où on passe à Postgres, cette fonction est réécrite avec PostGIS et rien d'autre ne change.

## 3. Modèle de données

Toutes les tables ont `created_at` et `updated_at`.

### `companies`

Une ligne par unité légale (SIREN) ayant au moins un établissement dans la zone d'ingestion.

| Colonne | Contenu |
|---|---|
| `siren` | clé primaire |
| `name` | nom affiché : nom commercial si présent, sinon raison sociale |
| `legal_name` | raison sociale |
| `trade_names` | JSON : nom commercial et enseignes |
| `naf_code`, `naf_label` | activité principale |
| `headcount_range`, `headcount_year` | code INSEE de tranche d'effectif et année de référence |
| `company_category` | PME, ETI ou GE |
| `founded_at` | date de création |
| `siret_local` | établissement retenu dans la zone d'ingestion |
| `address`, `postal_code`, `city` | adresse de cet établissement |
| `latitude`, `longitude` | coordonnées de cet établissement |
| `headquarters_in_zone` | booléen : le siège est-il dans la zone |
| `finances` | JSON : chiffre d'affaires et résultat net par année, tels que renvoyés par l'API |
| `website`, `website_source`, `website_confidence` | site trouvé, sa source (`offre`, `osm`, `devinette`, `manuel`) et une confiance de 0 à 1 |
| `careers_url`, `github_org`, `linkedin_url` | découverts au crawl |
| `description` | meta description ou og:description du site |
| `last_crawled_at` | date du dernier crawl du site |
| `raw_sirene` | JSON brut de l'API pour ne pas rappeler l'API à chaque nouveau champ |

### `tech_tags`

Dictionnaire des technologies, chargé depuis `packages/core/config/tech-tags.json` à la migration et synchronisé au début de chaque run.

| Colonne | Contenu |
|---|---|
| `slug` | clé primaire, ex. `nextjs` |
| `label` | ex. `Next.js` |
| `category` | `language`, `framework`, `database`, `cloud`, `tool`, `domain` |
| `aliases` | JSON : formes textuelles reconnues |
| `context_required` | JSON facultatif : motifs de contexte obligatoires pour les noms ambigus (Go, R, C, Rust, Swift) |

### `company_tech`

Une ligne par (entreprise, techno, source). Clé primaire composée.

| Colonne | Contenu |
|---|---|
| `siren`, `tag_slug` | références |
| `source` | `offre`, `site`, `github`, `manuel` |
| `confidence` | 0 à 1 |
| `evidence` | extrait de texte ou nom de l'empreinte |
| `detected_at` | date |

### `job_offers`

| Colonne | Contenu |
|---|---|
| `id` | identifiant France Travail |
| `source` | `france_travail` en V1 |
| `siren` | nullable, rempli par le rattachement |
| `employer_name` | nom brut donné par l'offre |
| `title`, `description`, `url`, `contract_type` | |
| `published_at`, `updated_at_source` | |
| `latitude`, `longitude`, `city` | lieu de travail |
| `is_active` | passe à faux après trois runs consécutifs sans la revoir |
| `last_seen_run_id` | dernier run d'ingestion l'ayant renvoyée |
| `raw` | JSON brut |

### `employer_aliases`

Mémorise les rattachements manuels : `employer_name_normalized` vers `siren`. Consulté avant toute correspondance automatique.

### `signals`

| Colonne | Contenu |
|---|---|
| `id` | |
| `siren` | référence |
| `kind` | `recruiting_now`, `hired_last_12_months`, `careers_page_found`, `github_active`, `revenue_growth`, `esn_suspected` |
| `value` | nombre (nombre d'offres, pourcentage de croissance, etc.) |
| `evidence` | texte |
| `detected_at` | date |

La commande `signals` recalcule entièrement les signaux dérivés (`recruiting_now`, `hired_last_12_months`, `careers_page_found`, `revenue_growth`). Les signaux `github_active` et `esn_suspected` sont écrits par leurs étapes respectives et conservés.

### `profiles`

| Colonne | Contenu |
|---|---|
| `id` | |
| `name` | |
| `home_label`, `home_latitude`, `home_longitude` | adresse géocodée |
| `radius_km` | |
| `skills` | JSON : liste de slugs de `tech_tags` |
| `headcount_ranges` | JSON : codes INSEE souhaités |

Une seule ligne en V1, créée à la migration avec les valeurs par défaut (Nice, 30 km, aucune compétence, tranches 03 à 22).

### `company_status`

Clé primaire (`profile_id`, `siren`). `status` parmi `to_review`, `interested`, `contacted`, `rejected`, `ignored`. `notes` en texte libre. Une entreprise sans ligne est considérée `to_review`.

### `crawl_runs`

`id`, `command`, `args` (JSON), `started_at`, `finished_at`, `stats` (JSON : traités, créés, mis à jour, erreurs), `errors` (JSON : liste de `{ siren, message }`).

## 4. Pipeline

Commande : `pnpm pipeline <étape> [options]`. Options communes : `--limit N`, `--force` (retraite ce qui a déjà été traité, sinon seulement le manquant), `--siren X` (une seule entreprise). Chaque run écrit une ligne dans `crawl_runs`. Une erreur sur une entreprise est journalisée et le run continue. Chaque source a son propre limiteur de débit.

La configuration vit dans `packages/core/config/` : `ingest.json` (codes NAF, tranches d'effectif, codes ROME), `tech-tags.json`, `esn-keywords.json`, `crawl-paths.json`. Validée par Zod au chargement.

### 4.1 `ingest sirene --departement 06`

Source : API Recherche d'entreprises, `https://recherche-entreprises.api.gouv.fr/search`. Sans clé. Limite 7 requêtes par seconde, 25 résultats par page.

Pour chaque code NAF de la config croisé avec chaque tranche d'effectif : pagination complète avec `etat_administratif=A`, `est_entrepreneur_individuel=false`, `departement=06`. Le croisement NAF par tranche sert à rester sous le plafond de résultats par requête.

Codes NAF par défaut : 62.01Z, 62.02A, 62.02B, 62.03Z, 62.09Z, 63.11Z, 63.12Z, 58.21Z, 58.29A, 58.29B, 58.29C, 72.19Z, 71.12B. Tranches par défaut : 03 à 22 (6 à 199 salariés). Les deux listes sont modifiables.

Le filtre département s'applique aux établissements. Pour chaque résultat, on retient l'établissement situé dans le département : le siège s'il y est, sinon le premier établissement actif de `matching_etablissements` dans ce département. On stocke ses coordonnées, l'adresse, et `headquarters_in_zone`. Les finances, la catégorie, le nom commercial et les enseignes sont copiés. Le JSON brut est conservé.

Upsert par SIREN. Une entreprise disparue de l'API n'est pas supprimée.

### 4.2 `ingest offres --departement 06`

Source : API Offres d'emploi v2 de France Travail. OAuth2 client credentials, scopes `o2dsoffre` et `api_offresdemploiv2`, identifiants dans `.env`. Limite 10 requêtes par seconde, 150 offres par page, index maximal 3000 par requête.

Codes ROME par défaut : M1805, M1810, M1802, M1806, M1803. Pour chaque code : pagination par `range`, découpage par fenêtre de dates (`minCreationDate`, `maxCreationDate`) si le total dépasse 3000.

Upsert par identifiant, avec mise à jour de `last_seen_run_id`. À la fin du run, une offre non vue depuis trois runs passe `is_active` à faux. Détection des technos dans le titre et la description via le dictionnaire, écrite dans `company_tech` avec `source=offre` pour les offres déjà rattachées ; la commande `match offres` fait de même pour celles qu'elle rattache.

### 4.3 `match offres`

Pour chaque offre sans SIREN :

1. Consulter `employer_aliases` avec le nom normalisé.
2. Sinon, normaliser le nom (minuscules, sans accents, sans ponctuation, sans forme juridique SAS, SARL, SA, SASU, EURL, SCOP) et le comparer à `legal_name`, `trade_names` et au nom normalisé des entreprises. Correspondance exacte d'abord, puis similarité par trigrammes avec un seuil de 0,9.
3. Exiger que le lieu de travail soit à moins de 15 km de l'établissement retenu. Si plusieurs entreprises passent, garder la plus proche.

Une offre rattachée reçoit son SIREN et ses technos sont écrites dans `company_tech`. Une offre non rattachée reste visible dans l'écran « employeurs inconnus ».

### 4.4 `discover websites`

Pour chaque entreprise sans site (ou toutes avec `--force`), sources dans l'ordre, on s'arrête à la première qui répond :

1. **Offres** : champ URL de l'entreprise dans une offre rattachée. Confiance 0,9.
2. **OpenStreetMap** via l'API Overpass : objets `office=*` ou `craft=*` avec une balise `website` dans un rayon de 300 m des coordonnées, dont le `name` normalisé correspond au nom de l'entreprise. Confiance 0,8. Une requête par seconde.
3. **Devinette de domaine** : slug du nom commercial (puis de la raison sociale) suivi de `.com`, `.fr`, `.io`, `.eu`, `.tech`. Pour chaque candidat : requête HEAD puis GET de la page d'accueil, et vérification que le titre ou la meta description contient au moins un mot significatif du nom (hors mots vides et hors mots de moins de 4 lettres). Confiance 0,6.
4. **Manuel** : saisie dans l'app. Confiance 1. Jamais écrasé par le pipeline, même avec `--force`.

### 4.5 `crawl websites`

Pour chaque entreprise avec un site et sans crawl depuis 30 jours (sauf `--force`) :

- Lire `robots.txt` et le respecter. Une requête par seconde par hôte, délai maximal 10 s, taille maximale 2 Mo, HTML uniquement. User-Agent explicite avec un contact.
- Pages visitées : accueil, puis les chemins de `crawl-paths.json` (carrière, jobs, recrutement, nous-rejoindre, about, a-propos, equipe, team, technologies, blog) et tout lien interne dont le texte contient « carrière », « recrutement », « jobs », « rejoindre ». Maximum 12 pages par site.
- Extraction :
  - `description` depuis meta description ou og:description.
  - `careers_url` : première page carrière trouvée.
  - `github_org` : lien vers `github.com/<org>` hors profils personnels évidents.
  - `linkedin_url` : lien vers `linkedin.com/company/...`.
  - Technos par mots-clés : recherche des alias du dictionnaire dans le texte visible, avec frontières de mots et contexte obligatoire pour les noms ambigus. Preuve : la phrase contenant le mot. Confiance 0,7 sur une page carrière ou technique, 0,5 ailleurs.
  - Technos par empreintes : marqueurs dans le HTML brut (`__next`, `_nuxt`, `data-sveltekit`, `ng-version`, `wp-content`, `data-reactroot`, `__remixContext`, noms de scripts chargés, meta `generator`, en-têtes `server` et `x-powered-by`). Confiance 0,9. Ces règles vivent dans `tech-tags.json` sous la clé `fingerprints` de chaque entrée.
  - ESN : mots de `esn-keywords.json` (ESN, SSII, régie, portage salarial, nos consultants, placement, sourcing, chasse de têtes) dans le texte visible. Produit un signal `esn_suspected` avec la phrase en preuve.
- Les lignes `company_tech` avec `source=site` de l'entreprise sont remplacées à chaque crawl.

### 4.6 `enrich github`

Pour chaque entreprise avec `github_org` : liste des dépôts publics (`/orgs/{org}/repos`), agrégation des langages, date du dernier push. Écrit `company_tech` avec `source=github` et confiance 0,8, et un signal `github_active` si un push date de moins de 6 mois. Token GitHub facultatif dans `.env` (60 requêtes par heure sans, 5000 avec).

### 4.7 `signals`

Recalcule les signaux dérivés :

- `recruiting_now` : nombre d'offres actives rattachées.
- `hired_last_12_months` : nombre d'offres rattachées publiées sur 12 mois.
- `careers_page_found` : `careers_url` non nul.
- `revenue_growth` : variation du chiffre d'affaires entre les deux dernières années disponibles, en pourcentage.

### 4.8 `run all`

Enchaîne les sept étapes dans l'ordre. Utilisé pour une mise à jour complète.

## 5. Dictionnaire des technos

Fichier `packages/core/config/tech-tags.json`, environ 150 entrées au départ. Structure d'une entrée :

```json
{
  "slug": "go",
  "label": "Go",
  "category": "language",
  "aliases": ["golang", "go"],
  "contextRequired": ["golang", "langage go", "go developer", "développeur go", "in go", "en go"],
  "fingerprints": []
}
```

Règles de détection dans `packages/core/src/detect.ts` :

- Correspondance insensible à la casse, avec frontières de mots.
- Si `contextRequired` est présent, un alias ne compte que si l'un des motifs de contexte apparaît dans la même phrase.
- Résultat : liste de `{ slug, evidence, confidence }` dédupliquée par slug avec la meilleure confiance.

La même fonction sert aux offres et aux sites. Elle est pure et testée sur des extraits réels.

## 6. Scoring

Fonction pure dans `packages/core/src/score.ts`, calculée à la lecture, jamais stockée. Entrées : le profil, l'entreprise avec ses technos, offres actives et signaux, et la distance. Sortie : un score de 0 à 100 et une liste de lignes d'explication `{ label, points }`.

| Critère | Calcul | Maximum |
|---|---|---|
| Technos communes | pour chaque techno de l'entreprise présente dans les compétences du profil, la meilleure confiance toutes sources confondues ; somme plafonnée à 4, ramenée sur 40 | 40 |
| Proximité | 20 × (1 − distance / rayon) | 20 |
| Taille | 15 si la tranche est dans celles souhaitées, sinon 0 | 15 |
| Offre active pertinente | 15 si une offre active contient au moins une compétence du profil, 8 si offre active sans correspondance | 15 |
| Signaux récents | 4 pour `hired_last_12_months`, 3 pour `github_active`, 3 pour `revenue_growth` positive | 10 |
| ESN suspectée | −20 | |

Le score est borné à 0. L'explication est affichée telle quelle sur la fiche.

## 7. Application web

Next.js App Router. Server Components pour la lecture, Server Actions pour l'écriture, `revalidatePath` après chaque mutation. Filtres dans les paramètres d'URL.

### 7.1 Exploration (`/`)

- Liste à gauche, carte à droite. Sur mobile, carte au-dessus, liste en dessous.
- Filtres : technos (multi), tranche d'effectif (multi), recrute actuellement, statut, tri (score, distance, taille). Recherche par nom.
- Chaque élément de liste : nom, distance, effectif, trois technos les plus confiantes, badge « recrute », score.
- Survoler un élément met le marqueur en avant. Cliquer un marqueur ouvre une carte résumée avec lien vers la fiche.
- État vide explicite quand la base est vide, avec la commande à lancer.

### 7.2 Fiche entreprise (`/entreprises/[siren]`)

Écran prioritaire. Sept blocs :

1. **Identité** : nom, raison sociale si différente, activité, effectif avec année, catégorie, date de création, adresse, distance, mention si le siège est ailleurs.
2. **Présence en ligne** : site, page carrière, GitHub, LinkedIn, liens de recherche LinkedIn et Google construits depuis le nom. Champ pour renseigner ou corriger le site, avec bouton « Analyser le site » qui lance `crawl websites --siren` en processus, délai maximal 60 s, résultat ou erreur affiché sans rechargement de page.
3. **Stack détectée** : technos groupées par catégorie. Badge de source sur chaque techno, preuve au survol. Les technos communes avec le profil sont mises en avant.
4. **Offres actives** : titre, type de contrat, date, lien.
5. **Signaux** : liste datée. Finances sur les années disponibles.
6. **Pourquoi cette entreprise** : score et lignes d'explication.
7. **Actions** : sélecteur de statut, zone de notes avec sauvegarde automatique, lien d'itinéraire.

### 7.3 Employeurs inconnus (`/employeurs-inconnus`)

Offres non rattachées groupées par nom d'employeur, triées par nombre d'offres. Pour chaque groupe : recherche d'une entreprise par nom dans la base et action « rattacher ». Le rattachement écrit `employer_aliases`, met à jour les offres et écrit les technos de ces offres dans `company_tech`.

### 7.4 Profil (`/profil`)

Formulaire : adresse (géocodée à la saisie via `https://api-adresse.data.gouv.fr/search`), rayon, sélecteur de compétences depuis le dictionnaire, tranches d'effectif souhaitées. Sauvegarde par Server Action.

### 7.5 Pipeline (`/pipeline`)

Tableau des derniers `crawl_runs` avec durée et statistiques, et compteurs globaux : entreprises, avec site, crawlées, technos détectées, offres actives, offres non rattachées. Lecture seule.

## 8. Gestion des erreurs

- Pipeline : toute erreur par entreprise est journalisée dans `crawl_runs.errors` et le run continue. Une erreur d'authentification France Travail arrête l'étape avec un message explicite. Les réponses d'API sont validées par Zod ; un champ inattendu est ignoré, une structure invalide est journalisée.
- Web : états vides explicites, erreurs de Server Action affichées dans le formulaire, crawl à la demande borné par un délai et affichant l'erreur brute.
- Géocodage : en cas d'échec, l'adresse précédente est conservée et un message l'indique.

## 9. Tests

Vitest, aucun accès réseau. Les réponses d'API sont enregistrées une fois en fixtures JSON dans `packages/pipeline/test/fixtures/`.

- `core` : normalisation des noms d'entreprise, détection de technos (alias, frontières de mots, contexte pour Go, R, C, Rust, Swift, empreintes HTML), scoring avec ses explications, distance haversine.
- `pipeline` : parsing de chaque source sur fixtures, choix de l'établissement local, rattachement offre → entreprise sur des cas du 06 (exact, forme juridique, enseigne, faux positif géographique), devinette de domaine sur pages HTML de test.
- `db` : requête de rayon sur SQLite en mémoire avec quelques points connus.
- `web` : fonctions de requête et de filtrage, sans rendu.

## 10. Mise en route

Prérequis : Node 22, pnpm. `.env` à la racine :

```
FRANCE_TRAVAIL_CLIENT_ID=
FRANCE_TRAVAIL_CLIENT_SECRET=
GITHUB_TOKEN=            # facultatif
DATABASE_URL=file:./data/novi.db
```

Le compte développeur France Travail se crée gratuitement sur francetravail.io, avec activation de l'API « Offres d'emploi v2 ».

```
pnpm install
pnpm db:migrate
pnpm pipeline run all --departement 06
pnpm dev
```

Le README reprend ces étapes et la liste des commandes du pipeline.

## 11. Évolutions prévues

- **PostGIS** : remplacer le module géographique, migrer Drizzle vers le driver Postgres. Le schéma ne change pas.
- **Enrichissement LLM** : une étape `enrich llm` optionnelle, sur les entreprises retenues seulement, qui produit une description structurée et des technos avec `source=llm`.
- **Multi-utilisateurs** : authentification, plusieurs `profiles`, scoring précalculé par profil.
- **Autres régions** : lancer l'ingestion sur d'autres départements ; le rayon et le point de départ sont déjà par profil.
- **Autres sources d'offres** : Welcome to the Jungle, sites carrière détectés au crawl.
