# Novi V2 : CV, lettres de motivation et nouvelles offres

Date : 6 octobre 2026. Suite de `2026-09-29-novi-v1-design.md`, dont les décisions restent valables sauf mention contraire.

## 1. Contexte et objectif

La V1 tourne sur les vraies données du 06 : 509 entreprises, 152 offres France Travail dont 40 rattachées. L'utilisateur a rempli son profil et commencé à suivre des entreprises. Trois besoins apparaissent à l'usage :

1. Importer son CV pour en extraire les technos au lieu de les cocher une à une, et disposer du texte pour les lettres.
2. Générer des lettres de motivation sur mesure, pour une offre ou en candidature spontanée, à partir du CV et de la fiche entreprise.
3. Voir les nouvelles offres d'un coup d'œil, les faire peser dans le score, et rafraîchir les offres automatiquement sans relancer le pipeline à la main.

### Décisions prises pendant le cadrage

| Sujet | Décision | Pourquoi |
|---|---|---|
| Coût | Toujours 100 % gratuit. LLM public à palier gratuit (Gemini en premier choix) via un adaptateur compatible OpenAI. Adaptateur Anthropic présent mais optionnel. | L'abonnement claude.ai ne donne pas accès à l'API ; les paliers gratuits suffisent pour quelques lettres par semaine. |
| Confidentialité | Le CV est anonymisé de façon réversible avant tout envoi : le LLM voit des jetons, la lettre finale contient les vraies valeurs, remplacées localement. | Le palier gratuit de Google peut utiliser les données envoyées. |
| CV | Un seul CV par profil, PDF uniquement. Seul le texte extrait est conservé. | Besoin réel de l'utilisateur ; YAGNI. |
| Lettre | Depuis la fiche (spontanée) ou depuis une offre. Consigne libre facultative. Historique conservé par entreprise. | La candidature spontanée est le cœur de Novi. |
| Nouveauté | « Récente » = publiée depuis moins de N jours (7 par défaut, réglable). « Non vue » = pas encore affichée dans une fiche, mémorisé par profil. | Les deux notions se complètent : revoir les nouveautés de la semaine, et savoir ce qu'on n'a pas encore regardé. |
| Score | Bonus pour une offre correspondante et récente. | Demande explicite. |
| Rafraîchissement | Commande `pipeline refresh` planifiée par le Planificateur de tâches Windows. | L'app Next.js n'est pas forcément lancée ; pas de démon à maintenir. |
| Code | Nouveau paquet `packages/assist`. | `core` reste sans I/O ; `pipeline` n'a pas besoin du LLM ; l'app web reste mince. |

### Hors périmètre V2

Streaming de la lettre pendant la génération, plusieurs CV, export PDF/DOCX de la lettre, OCR des CV scannés, notification système ou e-mail à l'arrivée d'une offre, planification sur macOS/Linux (documentée mais pas scriptée).

## 2. Architecture

```
packages/assist   (@novi/assist)  dépend de @novi/core
  src/pdf.ts            extractPdfText(buffer) via unpdf
  src/cv.ts             analyzeCv(text, tags), detectIdentityHints(text)
  src/privacy.ts        anonymize(text, identity), restore(text, identity), PLACEHOLDERS
  src/llm/types.ts      TextGenerator, GenerateInput, GenerateResult, LlmError
  src/llm/openai-compatible.ts
  src/llm/anthropic.ts
  src/llm/index.ts      createGenerator(env) -> TextGenerator | null, describeGenerator(env)
  src/letter.ts         buildLetterPrompt(input) -> { system, prompt }
  src/index.ts
packages/db        migration 0002, tables cover_letters et offer_views, colonnes profils
packages/core      score.ts (bonus récence), types.ts (publishedAt sur les offres du score)
packages/pipeline  steps/refresh.ts, cli « refresh »
apps/web           profil (CV, identité, N jours), fiche (lettres, badges, vues), carte, liste, filtres, pipeline
scripts/           install-refresh-task.ps1, uninstall-refresh-task.ps1
```

Règles inchangées : les composants client n'importent jamais `@novi/db`, `@novi/pipeline` ni `@novi/assist` (ce dernier tire `unpdf` et le SDK Anthropic, inutiles et lourds côté navigateur). Ils importent `@novi/core`, des types et les actions serveur.

### Variables d'environnement

| Variable | Rôle | Exemple |
|---|---|---|
| `LLM_PROVIDER` | `openai-compatible` ou `anthropic`. Absente : fonctionnalité masquée. | `openai-compatible` |
| `LLM_BASE_URL` | Base de l'API compatible OpenAI, sans `/chat/completions`. | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `LLM_API_KEY` | Clé du fournisseur. Pour Anthropic, la clé API Anthropic. | |
| `LLM_MODEL` | Identifiant du modèle. | `gemini-2.5-flash` (à ajuster selon le palier gratuit du jour) ; `claude-opus-5-5` pour Anthropic |

`.env.example` documente les trois fournisseurs gratuits courants (Gemini, Groq, Mistral) avec leur base URL, et la variante Anthropic.

## 3. Modèle de données

Migration Drizzle `0002`.

### `profiles` (colonnes ajoutées)

| Colonne | Type | Rôle |
|---|---|---|
| `first_name`, `last_name` | text, nullable | Identité pour l'anonymisation et la signature. |
| `email`, `phone`, `postal_address` | text, nullable | Idem. |
| `links` | json `string[]`, défaut `[]` | LinkedIn, GitHub, site perso. Masqués eux aussi. |
| `reveal_first_name` | boolean, défaut `false` | Si vrai, le prénom passe en clair au LLM. |
| `cv_filename`, `cv_text`, `cv_pages`, `cv_uploaded_at` | text / text / integer / text, nullable | CV importé. Réimporter remplace. |
| `new_offer_days` | integer, défaut `7` | Fenêtre de « récence ». |

### `cover_letters`

| Colonne | Type |
|---|---|
| `id` | integer, clé primaire auto |
| `profile_id` | integer, FK `profiles.id`, cascade |
| `siren` | text, FK `companies.siren`, cascade |
| `offer_id` | text, FK `job_offers.id`, `set null`, nullable |
| `instruction` | text, nullable |
| `content` | text, non nul (lettre restaurée) |
| `model` | text, non nul (`provider/model`) |
| `created_at` | text, non nul |

Index sur `(profile_id, siren)`.

### `offer_views`

| Colonne | Type |
|---|---|
| `profile_id` | integer, FK `profiles.id`, cascade |
| `offer_id` | text, FK `job_offers.id`, cascade |
| `seen_at` | text, non nul |

Clé primaire `(profile_id, offer_id)`. Une offre est « non vue » pour un profil tant qu'elle n'y figure pas.

## 4. Paquet `@novi/assist`

### 4.1 Extraction PDF

`extractPdfText(buffer: Uint8Array): Promise<{ text: string; pages: number }>` avec `unpdf` (`extractText(..., { mergePages: true })`). Limites : 5 Mo et 10 pages, au-delà `AssistError('cv_too_large')`. Texte normalisé : retours à la ligne multiples réduits, espaces insécables remplacés. Si le texte nettoyé fait moins de 50 caractères, `AssistError('cv_no_text')` (PDF image).

### 4.2 Analyse du CV

`analyzeCv(text, tags)` retourne `{ techs: Detection[] }` en réutilisant `detectTechs` avec la confiance `0.9` (source `cv`). Les détections ne sont pas écrites en base : elles servent à proposer des compétences au formulaire de profil.

`detectIdentityHints(text)` retourne `{ email?, phone?, links: string[], nameCandidates: string[] }` :

- e-mail : première correspondance d'une regex e-mail ;
- téléphone : première correspondance d'un numéro français (`0X XX XX XX XX`, `+33 X …`, avec espaces, points ou tirets) ;
- liens : URL contenant `linkedin.com`, `github.com`, `gitlab.com`, ou tout `https://` hors domaines d'entreprise connus, dédoublonnées ;
- candidats nom : les trois premières lignes non vides de deux à quatre mots dont chaque mot commence par une majuscule. Jamais appliqués sans confirmation.

### 4.3 Anonymisation réversible

`Identity = { firstName?, lastName?, email?, phone?, postalAddress?, links: string[], revealFirstName: boolean }`.

`anonymize(text, identity): string` :

1. Pour chaque valeur déclarée non vide, remplace toutes les occurrences par son jeton : `[NOM]`, `[PRENOM]` (sauf si `revealFirstName`), `[EMAIL]`, `[TELEPHONE]`, `[ADRESSE]`, `[LIEN_1]`, `[LIEN_2]`… Comparaison insensible à la casse et aux accents (même normalisation que `normalize.ts`), appliquée sur le texte d'origine via une regex construite à partir de la valeur normalisée, pour conserver le reste du texte intact. Les valeurs sont traitées de la plus longue à la plus courte pour que « Jean-Pierre » parte avant « Jean ».
2. Filet : toute adresse e-mail restante devient `[EMAIL]`, tout numéro français restant `[TELEPHONE]`. Pas de filet pour les noms : impossible sans faux positifs.
3. Les valeurs de moins de trois caractères sont ignorées (un nom « Li » masquerait trop de mots).

`restore(text, identity): string` remplace chaque jeton par sa valeur ; un jeton sans valeur (prénom révélé, lien absent) est remplacé par une chaîne vide, et les doubles espaces résultants nettoyés.

Les jetons sont également interdits de collision : si le texte d'origine contient déjà `[NOM]`, il est échappé en `[[NOM]]` avant anonymisation et rétabli après restauration.

### 4.4 Générateur de texte

```ts
type GenerateInput = { system: string; prompt: string; maxTokens: number };
type GenerateResult = { text: string; model: string };
interface TextGenerator { readonly label: string; generate(input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult>; }
```

`LlmError` porte un `code` : `unauthorized` (401/403), `rate_limited` (429, avec `retryAfterSeconds` si l'en-tête est présent), `timeout`, `bad_response` (JSON inattendu ou texte vide), `refused` (le modèle a refusé de répondre), `http` (autre statut). Les messages sont en français et affichables tels quels.

**openai-compatible** : `POST {LLM_BASE_URL}/chat/completions` avec `{ model, messages: [{role:'system'}, {role:'user'}], max_tokens, temperature: 0.7 }`, en-tête `Authorization: Bearer`. Réponse lue dans `choices[0].message.content`. Délai 60 s via `AbortSignal.timeout`. Aucune nouvelle dépendance.

**anthropic** : `@anthropic-ai/sdk`, `client.messages.create({ model, max_tokens, system, messages })`, texte concaténé des blocs `text`. `stop_reason === 'refusal'` devient `LlmError('refused')`. Le SDK est une dépendance du paquet mais n'est importé que dynamiquement (`await import`) quand `LLM_PROVIDER=anthropic`, pour ne pas peser au démarrage. Modèle par défaut si `LLM_MODEL` absent : `claude-opus-5-5`.

`createGenerator(env = process.env): TextGenerator | null` retourne `null` si `LLM_PROVIDER` est absent, et lève `AssistError('llm_misconfigured')` avec le nom de la variable manquante si le fournisseur est nommé mais incomplet. `describeGenerator(env)` retourne `{ configured: boolean; label?: string; problem?: string }` pour l'affichage.

### 4.5 Prompt de lettre

`buildLetterPrompt(input)` avec :

```ts
type LetterInput = {
  profile: { homeLabel: string; skills: string[] }; // homeLabel : ville seulement, jamais l'adresse complète
  cvText: string;               // déjà anonymisé
  company: { name: string; city: string | null; headcountLabel: string | null; description: string | null;
             techs: { label: string; source: string }[]; careersUrl: string | null; website: string | null };
  offer?: { title: string; contractType: string | null; description: string | null; city: string | null };
  instruction?: string;
  revealFirstName: boolean;
};
```

Système (français) : rédacteur de lettres de motivation pour un développeur ; une page maximum (250 à 350 mots) ; ton direct et concret, pas de formules creuses ; s'appuyer uniquement sur les expériences présentes dans le CV, ne rien inventer ; relier explicitement deux ou trois technos ou projets du candidat à ce que fait l'entreprise ; si une information manque, rester général plutôt qu'inventer ; les jetons entre crochets comme `[NOM]` ou `[TELEPHONE]` sont des espaces réservés à recopier tels quels, notamment dans l'en-tête et la signature ; rendre uniquement la lettre, sans commentaire.

Utilisateur : CV, puis entreprise (champs disponibles seulement), puis offre si présente, puis « Consigne particulière » si présente, puis la demande : « Rédige la lettre de candidature spontanée » ou « Rédige la lettre de motivation pour cette offre ».

`maxTokens` : 2048 (sortie volontairement courte).

## 5. Score

Dans `ScoreCompany.activeOffers`, chaque offre porte désormais `publishedAt: string | null`. `ScoreProfile` gagne `newOfferDays: number`. `scoreCompany` reçoit `now` en paramètre optionnel (défaut `new Date()`) pour rester testable.

Ligne « offres » :

| Cas | Points | Libellé |
|---|---|---|
| Au moins une offre correspondant au profil et récente | 20 | « N offre(s) récente(s) correspondant au profil » |
| Au moins une offre correspondant au profil | 15 | inchangé |
| Offres actives sans correspondance, dont une récente | 10 | « N offre(s) active(s), dont K récente(s) » |
| Offres actives sans correspondance | 8 | inchangé |

Une offre est récente si `publishedAt` est non nul et `now - publishedAt < newOfferDays` jours. Le total théorique passe de 100 à 105 ; l'affichage ne plafonne pas.

## 6. Pipeline

### 6.1 `refresh --departement 06`

Enchaîne `ingest offres`, `match offres`, `signals`, avec la même tolérance aux échecs que `run all`. Avant l'ingestion, mémorise l'identifiant de run ; après, compte les offres dont `created_at` est postérieur au début du refresh et journalise « N nouvelles offres, M rattachées ». Sans identifiants France Travail, s'arrête immédiatement avec un avertissement et le code de sortie 1.

### 6.2 Planification Windows

`scripts/install-refresh-task.ps1 [-IntervalHours 6] [-Departement 06]` :

- résout le chemin absolu de `pnpm` et du dépôt ;
- crée `data/logs/` ;
- enregistre via `Register-ScheduledTask` une tâche « Novi refresh » qui exécute `pnpm pipeline refresh -d 06 *>> data/logs/refresh.log` toutes les `IntervalHours` heures, en session utilisateur, sans fenêtre, « démarrer dès que possible si une exécution a été manquée », pas de lancement si la batterie est faible ;
- affiche la prochaine exécution.

`scripts/uninstall-refresh-task.ps1` supprime la tâche. Le README explique l'équivalent `cron` pour macOS/Linux en une ligne.

Le journal est tronqué par le script à 1 Mo au démarrage de chaque exécution (les 500 dernières lignes sont conservées).

## 7. Application web

### 7.1 Profil (`/profil`)

Nouvelle section « CV » en tête :

- Champ fichier `.pdf` et bouton « Importer ». Action serveur `uploadCv(formData)` : vérifie `type === 'application/pdf'` et taille, extrait, enregistre `cv_*`, puis pré-remplit e-mail, téléphone et liens de l'identité s'ils sont vides, et retourne `{ techs, nameCandidates, hints }`.
- Après import : nom du fichier, date, pages ; puces « déjà dans le profil » (gris) et « détectées dans le CV, absentes du profil » (accent) avec « Tout ajouter au profil », qui coche ces compétences dans le formulaire sans enregistrer ; « Voir le texte extrait » replié.
- Au chargement de la page, si un CV existe, les technos sont recalculées à la volée (pas de table) pour afficher les mêmes listes.
- Erreurs affichées en clair : « ce fichier n'est pas un PDF », « plus de 10 pages », « aucun texte trouvé, le PDF semble être une image ».

Section « Identité » : prénom, nom, e-mail, téléphone, adresse postale, liens (un par ligne), case « laisser passer mon prénom au LLM ». Les candidats nom issus du CV sont proposés sous forme de boutons « Utiliser : Jean Dupont » qui remplissent prénom et nom. Un encart explique en deux phrases que ces valeurs ne quittent jamais la machine et servent à les masquer puis les rétablir.

Section « Nouveautés » : « Considérer une offre comme nouvelle pendant N jours ».

Toutes ces valeurs sont enregistrées par le bouton « Enregistrer le profil » existant (`ProfileInput` étendu).

### 7.2 Fiche entreprise (`/entreprises/[siren]`)

- Au rendu serveur, les offres actives de l'entreprise non encore présentes dans `offer_views` sont marquées « non vue » dans la réponse, puis insérées dans `offer_views` (marquage après lecture, dans la même requête). Au rechargement suivant, le point disparaît.
- Chaque offre : badge « Nouveau » si récente, point « non vue » si elle vient d'être marquée.
- Encart « Lettre de motivation » :
  - si générateur non configuré : « Aucun fournisseur LLM configuré. Voir le README. » ;
  - sinon si pas de CV : « Importez votre CV dans le profil pour générer des lettres. » avec lien ;
  - sinon : bouton « Lettre spontanée », et sur chaque offre active « Lettre pour cette offre ».
- Clic : panneau avec consigne facultative et « Générer ». Pendant la génération : bouton désactivé, « Génération… ». Résultat dans un `textarea` éditable, boutons « Copier », « Régénérer », mention « Généré avec {modèle} ». Lien « Voir ce qui a été envoyé » qui affiche le prompt anonymisé, conservé uniquement dans l'état du composant.
- Volet replié « Lettres générées (N) » avec les précédentes, triées par date décroissante, chacune avec « Copier » et « Supprimer ».
- Action serveur `generateLetter({ siren, offerId?, instruction? })` : charge profil, CV, entreprise, offre ; construit l'identité, avec refus si le nom n'est pas renseigné dans le profil (sans lui, le CV ne peut pas être anonymisé) ; anonymise CV, consigne et offre (le texte d'une offre peut contenir le nom du candidat si c'est une offre déjà échangée, improbable mais sans coût) ; appelle le générateur avec un délai de 60 s ; restaure ; insère dans `cover_letters` ; retourne `{ ok, letter, model, sentPrompt }`. En cas d'erreur, retourne `{ ok: false, error }` sans rien écrire ; pour `rate_limited`, le message inclut « réessayez dans X secondes » si connu.
- Action `deleteLetter(id)`.

### 7.3 Exploration (`/`)

- `CompanyListItem` gagne `recentOffers: number` et `unseenOffers: number`.
- Carte : couleur de marqueur orange `#ea580c` avec halo CSS si `recentOffers > 0`, sinon vert si `recruiting`, sinon bleu. Légende de trois pastilles sous la carte.
- Liste : badge « Nouveau ×N » quand `recentOffers > 0`, puis badge neutre « Non vue ×N » quand `unseenOffers > 0`.
- Filtres : case « Nouvelles offres » (paramètre d'URL `nouvelles=1`), qui ne garde que `recentOffers > 0`, et case « Offres jamais consultées » (paramètre `nonvues=1`), qui ne garde que `unseenOffers > 0`.
- Bandeau en haut de page si des offres actives dans le rayon sont absentes de `offer_views` : « N offres jamais consultées », lien « Voir les entreprises concernées » vers le filtre `nonvues=1` (et non `nouvelles=1` : une offre jamais consultée n'est pas forcément récente). Calcul : offres actives rattachées à une entreprise du rayon et absentes de `offer_views`.

### 7.4 Pipeline (`/pipeline`)

Ligne « Dernier refresh : il y a 3 h (12 offres, 2 nouvelles) » d'après le dernier `crawl_runs` de nom `refresh`. Si le dernier refresh date de plus de 12 h, avertissement « Le rafraîchissement automatique semble arrêté » avec rappel de la commande d'installation.

## 8. Gestion des erreurs

- Toute erreur de `@novi/assist` est une `AssistError` ou une `LlmError` avec un `code` et un message français ; les actions serveur transmettent le message tel quel.
- Un échec LLM n'écrit rien en base.
- `uploadCv` est idempotent : un nouvel import remplace le précédent dans la même transaction.
- Le marquage `offer_views` au rendu de la fiche ignore les erreurs d'écriture (journalisées) pour ne jamais casser l'affichage.
- `refresh` suit le journal `crawl_runs` comme les autres étapes : chaque sous-étape a son run, plus un run `refresh` englobant avec le résumé.

## 9. Tests

Vitest, sans réseau :

- `assist/pdf` : un PDF texte de deux pages généré en fixture, un PDF vide, un PDF trop long (mock de `unpdf` pour le nombre de pages).
- `assist/cv` : détection des technos sur un extrait de CV, détection e-mail / téléphone / liens, candidats nom (positifs et faux positifs comme « Expérience Professionnelle »).
- `assist/privacy` : aller-retour `restore(anonymize(x)) === x` sur des cas avec casse et accents différents, prénom composé, valeur courte ignorée, jeton déjà présent dans le texte, filet regex, prénom révélé.
- `assist/llm` : `openai-compatible` avec `fetch` mocké (succès, 401, 429 avec `retry-after`, réponse sans `choices`, délai) ; `createGenerator` (absent, incomplet, complet) ; l'adaptateur Anthropic avec le SDK mocké par `vi.mock`.
- `assist/letter` : le prompt contient les sections attendues et seulement celles disponibles ; la consigne est incluse ; les jetons sont mentionnés dans le système.
- `core/score` : les quatre cas de la ligne offres, avec `now` fixé.
- `db` : migration 0002 sur une base V1 réelle (fixture), contraintes `offer_views`.
- `pipeline/refresh` : enchaînement avec étapes mockées, arrêt sans identifiants, comptage des nouvelles offres.
- `web` : `uploadCv` (refus non-PDF, remplacement), `generateLetter` avec générateur injecté (succès, échec sans écriture, restauration des jetons), marquage `offer_views` au rendu, filtre `nouvelles`, `listCompanies` avec `recentOffers`.

## 10. Mise en route

1. `pnpm install` (ajoute `unpdf` et `@anthropic-ai/sdk` au paquet assist).
2. `pnpm db:migrate`.
3. Créer une clé sur Google AI Studio, renseigner `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` dans `.env`.
4. `/profil` : importer le CV, confirmer l'identité, enregistrer.
5. `pwsh scripts/install-refresh-task.ps1` pour le rafraîchissement toutes les 6 heures.

## 11. Évolutions prévues

Streaming de la génération, export de la lettre en PDF, plusieurs CV ciblés, notification à l'arrivée d'une offre correspondant au profil, planification multiplateforme, et, si l'anonymisation par valeurs connues ne suffit plus, un passage par un modèle local de reconnaissance d'entités.
