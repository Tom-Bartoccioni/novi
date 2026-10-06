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

const SYSTEM_BASE = [
  'Tu rédiges des lettres de motivation en français pour un développeur ou une développeuse.',
  '',
  'Règles :',
  '- Une page maximum, entre 250 et 350 mots, en paragraphes courts.',
  '- Ton direct et concret, sans formules creuses ni flatterie.',
  "- Appuie-toi uniquement sur les expériences, projets et compétences présents dans le CV : n'invente rien,",
  '  aucune expérience, aucun chiffre, aucun diplôme absent du CV.',
  "- Relie explicitement deux ou trois technos ou projets du candidat à ce que fait l'entreprise ;",
  "  si une information manque, reste général plutôt que d'inventer.",
  '- Les jetons entre crochets comme [NOM], [PRENOM], [EMAIL], [TELEPHONE], [ADRESSE] ou [LIEN_1] sont',
  '  des espaces réservés : recopie-les tels quels là où l’information est attendue (en-tête, signature),',
  '  sans les modifier ni les expliquer.',
  '- Rends uniquement la lettre, sans titre, sans commentaire avant ou après.',
].join('\n');

const SYSTEM_REVEALED =
  '\n- Le prénom du candidat est en clair dans le CV ; tu peux l’utiliser dans la signature.';

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
