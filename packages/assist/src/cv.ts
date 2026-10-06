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

const LINK_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|gitlab\.com)\/[\w\-./]+|https?:\/\/[^\s|)]+/g;
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
  const email = text.match(EMAIL_PATTERN)?.[0];
  const phone = text.match(PHONE_PATTERN)?.[0];
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
