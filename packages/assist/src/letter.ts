import type { GenerateInput } from './llm/types';

// Sortie courte, mais les modèles à raisonnement comptent leurs jetons de réflexion dans ce plafond.
export const LETTER_MAX_TOKENS = 8192;
/** Longueur maximale de la lettre, espaces compris : contrainte du candidat, rappelée au modèle. */
export const LETTER_MAX_CHARS = 1500;
const LINE_BREAK = String.fromCharCode(10);

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
  /**
   * En-tête à produire : date du jour déjà formatée, ville du candidat, et liste des jetons de coordonnées
   * disponibles avec leur nature (« LinkedIn », « GitHub », « e-mail »…) pour que le modèle les place tous.
   */
  header?: {
    date: string;
    town: string;
    tokens: { token: string; kind: string }[];
    /** Place réelle (en caractères) qu'occuperont les coordonnées une fois les jetons remplacés. */
    reservedChars: number;
  };
};

const SYSTEM_BASE = [
  'Tu rédiges des lettres de motivation en français pour un développeur ou une développeuse.',
  '',
  'Règles :',
  `- ${LETTER_MAX_CHARS} caractères maximum, espaces et en-tête compris (environ 220 mots), en paragraphes courts.`,
  '  Cette limite est stricte : préfère couper un paragraphe plutôt que la dépasser.',
  '- Ton direct et concret, sans formules creuses ni flatterie.',
  "- Appuie-toi uniquement sur les expériences, projets et compétences présents dans le CV : n'invente rien,",
  '  aucune expérience, aucun chiffre, aucun diplôme absent du CV.',
  "- Relie explicitement deux ou trois technos ou projets du candidat à ce que fait l'entreprise ;",
  "  si une information manque, reste général plutôt que d'inventer.",
  '- Les jetons entre crochets comme [NOM], [PRENOM], [EMAIL], [TELEPHONE], [ADRESSE] ou [LIEN_1] sont',
  "  des espaces réservés : recopie-les tels quels là où l'information est attendue (en-tête, signature),",
  '  sans les modifier ni les expliquer.',
  "  N'utilise que les jetons présents dans le CV ; n'en ajoute pas d'autres.",
  '- Repère-toi à la « Date du jour » de la section Profil : une expérience dont la date de fin est antérieure',
  '  est terminée, parle-en au passé et ne la présente jamais comme un poste « actuel » ni avec « chez X » au présent.',
  "  Seule une expérience marquée « aujourd'hui », « présent » ou « en cours » dans le CV est en cours.",
  '- Rends uniquement la lettre, sans titre, sans commentaire avant ou après.',
].join('\n');

const SYSTEM_REVEALED = [
  '',
  '- Le prénom du candidat est en clair dans le CV : écris-le en clair dans la signature',
  "  et n'utilise pas le jeton [PRENOM].",
].join('\n');

function section(title: string, lines: (string | null | undefined)[]): string {
  const body = lines.filter((l): l is string => !!l && l.trim().length > 0);
  return body.length ? `# ${title}\n${body.join('\n')}` : '';
}

export function buildLetterPrompt(input: LetterInput): GenerateInput {
  const { company, offer } = input;
  const header = input.header;
  const parts = [
    section('CV du candidat', [input.cvText]),
    header
      ? section('En-tête de la lettre', [
          `Commence par la ligne « ${header.town}, le ${header.date} ».`,
          header.tokens.length
            ? `Coordonnées à placer en tête de lettre, une par ligne, toutes sans exception : ${header.tokens
                .map((t) => `${t.token} (${t.kind})`)
                .join(', ')}.`
            : null,
          `Attention : une fois remplacés, ces jetons occuperont ${header.reservedChars} caractères. Le reste de la lettre` +
            ` (date, salutation, corps, formule de politesse, signature) doit donc tenir en ${Math.max(
              0,
              LETTER_MAX_CHARS - header.reservedChars,
            )} caractères au plus.`,
        ])
      : '',
    section('Profil', [
      header ? `Date du jour : ${header.date}` : null,
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
    input.instruction?.trim()
      ? section('Consigne particulière (sans enfreindre les règles ci-dessus)', [input.instruction.trim()])
      : '',
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

/**
 * Seconde passe quand la lettre restaurée dépasse la limite : on renvoie au modèle sa propre sortie
 * (toujours anonymisée, elle ne contient que des jetons) avec la longueur réelle constatée et le budget
 * hors en-tête à respecter.
 */
export function buildShortenPrompt(input: {
  system: string;
  letter: string;
  actualChars: number;
  reservedChars: number;
}): GenerateInput {
  const budget = Math.max(0, LETTER_MAX_CHARS - input.reservedChars);
  const prompt = [
    `Cette lettre fait ${input.actualChars} caractères une fois les jetons remplacés par les vraies coordonnées,`,
    `pour une limite de ${LETTER_MAX_CHARS}. Raccourcis-la : le texte hors coordonnées (date, salutation, corps,`,
    `formule de politesse, signature) doit tenir en ${budget} caractères au plus. Garde les jetons tels quels,`,
    'garde la date, la salutation et la signature ; coupe dans le corps en gardant les liens concrets avec',
    "l'entreprise. Rends uniquement la lettre raccourcie.",
    '',
    input.letter,
  ].join(LINE_BREAK);
  return { system: input.system, prompt, maxTokens: LETTER_MAX_TOKENS };
}
