import { type Detection, detectTechs, stripAccents, type TechTag } from '@novi/core';
import { EMAIL_PATTERN, PHONE_PATTERN } from './privacy';

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

/**
 * Deux branches. La première reconnaît les profils LinkedIn, GitHub et GitLab, avec ou sans schéma, « www. » ou
 * sous-domaine (« fr.linkedin.com »), sans être collée à un mot ou à un domaine qui précède. La seconde prend toute
 * URL avec schéma, jusqu'au premier blanc ou délimiteur courant.
 */
const LINK_RE =
  /(?<![\w.-])(?:https?:\/\/)?(?:www\.)?(?:[\w-]+\.)?(?:linkedin\.com|github\.com|gitlab\.com)\/[\w\-./]+|https?:\/\/[^\s|)<>[\]"'«»]+/gi;
const NAME_LINES_SCANNED = 15;
const NAME_CANDIDATES_MAX = 3;
/** Mots de rubrique ou d'intitulé de poste : une ligne qui en contient n'est pas un nom. */
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
  'lead',
  'dev',
  'fullstack',
  'skills',
  'backend',
  'frontend',
  'devops',
  'web',
  'data',
]);
/** Particules admises au milieu d'un nom (« Jean de La Fontaine »). */
const NAME_PARTICLES = new Set(['de', 'du', 'des', "d'", 'd’', 'la', 'le', 'van', 'von', 'der', 'di', 'da']);
const NAME_WORD_RE = /^\p{Lu}[\p{L}'’-]*$/u;

/** Clé de comparaison d'un lien : hôte en minuscule, sans schéma, sans « www. » ni « / » final. */
function linkKey(link: string): string {
  return link
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

function isNameWord(word: string, index: number, count: number): boolean {
  if (NAME_WORD_RE.test(word)) return true;
  return index > 0 && index < count - 1 && NAME_PARTICLES.has(word);
}

function normalizeLink(raw: string): string {
  const trimmed = raw.replace(/[.,;:!?)\]>"'»]+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function detectIdentityHints(text: string): IdentityHints {
  const email = text.match(EMAIL_PATTERN)?.[0];
  const phone = text.match(PHONE_PATTERN)?.[0];
  const links = new Map<string, string>();
  for (const m of text.matchAll(LINK_RE)) {
    const link = normalizeLink(m[0]);
    const key = linkKey(link);
    if (!links.has(key)) links.set(key, link);
  }
  const nameCandidates: string[] = [];
  for (const line of text.split('\n').slice(0, NAME_LINES_SCANNED)) {
    const clean = line.normalize('NFC').trim();
    if (!clean) continue;
    const words = clean.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    if (!words.every((w, i) => isNameWord(w, i, words.length))) continue;
    const isHeading = words.some((w) =>
      stripAccents(w)
        .toLowerCase()
        .split('-')
        .some((part) => HEADING_WORDS.has(part)),
    );
    if (isHeading) continue;
    nameCandidates.push(clean);
    if (nameCandidates.length >= NAME_CANDIDATES_MAX) break;
  }
  return { email, phone, links: [...links.values()], nameCandidates };
}
