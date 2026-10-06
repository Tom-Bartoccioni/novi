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
  identity.links.forEach((link, i) => {
    push(link, linkToken(i));
  });
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
