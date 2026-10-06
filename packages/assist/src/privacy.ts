export type Identity = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  postalAddress?: string | null;
  links: string[];
  revealFirstName: boolean;
};

/** Nom de jeton de chaque champ d'identité : source unique des jetons et des expressions qui les lisent. */
const FIELD_KEYS = {
  firstName: 'PRENOM',
  lastName: 'NOM',
  email: 'EMAIL',
  phone: 'TELEPHONE',
  postalAddress: 'ADRESSE',
} as const;
type Field = keyof typeof FIELD_KEYS;
const FIELDS = Object.keys(FIELD_KEYS) as Field[];

export const TOKENS = Object.fromEntries(FIELDS.map((f) => [f, `[${FIELD_KEYS[f]}]`])) as {
  readonly [F in Field]: `[${(typeof FIELD_KEYS)[F]}]`;
};

export function linkToken(index: number): string {
  return `[LIEN_${index + 1}]`;
}

const MIN_VALUE_LENGTH = 3;
const TOKEN_ALT = `${Object.values(FIELD_KEYS).join('|')}|LIEN_\\d+`;
const TOKEN_RE = new RegExp(`\\[(${TOKEN_ALT})\\]`, 'g');
const PROTECTED_RE = new RegExp(`\\[\\[(${TOKEN_ALT})\\]\\]`, 'g');

/** Adresse électronique quelconque (sans drapeau `g`, réutilisable telle quelle). */
export const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
/**
 * Numéro français non collé à d'autres chiffres : 0X, +33 X ou 0033 X (avec un « (0) » facultatif),
 * puis quatre paires de chiffres séparées ou non par espace, point ou tiret. Sans drapeau `g`.
 */
export const PHONE_PATTERN =
  /(?<!\d)(?:(?:\+33|0033)[\s.-]?(?:\(0\))?[\s.-]?[1-9]|0[1-9])(?:[\s.-]?\d{2}){4}(?!\d)/;
const EMAIL_RE = new RegExp(EMAIL_PATTERN.source, 'g');
const PHONE_RE = new RegExp(PHONE_PATTERN.source, 'g');

/**
 * Replie chaque unité de code sur sa lettre de base en minuscule, en gardant la même longueur que l'entrée,
 * pour pouvoir reporter les positions trouvées sur le texte d'origine. L'entrée doit être en NFC.
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

/** Intervalles [début, fin[ des jetons, simples ou protégés, présents dans `text`. */
function tokenSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const re of [PROTECTED_RE, TOKEN_RE]) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      spans.push([start, start + m[0].length]);
    }
  }
  return spans;
}

/**
 * Remplace, dans `text` (en NFC), chaque occurrence de `value` par `token`. Casse et accents sont ignorés,
 * toute suite de blancs de la valeur accepte n'importe quelle suite de blancs, et l'occurrence doit être
 * bornée par des non-lettres. Une occurrence située dans un jeton existant est ignorée. Une occurrence entre
 * crochets, « [Dupont] », est remplacée crochets compris pour ne pas fabriquer « [[NOM]] », que `restore`
 * lirait comme un jeton littéral : les crochets sont donc perdus à la restauration.
 */
function replaceValue(text: string, value: string, token: string): string {
  const needle = fold(value.normalize('NFC').trim());
  if (needle.length < MIN_VALUE_LENGTH) return text;
  const pattern = escapeRegex(needle).replace(/\s+/g, '\\s+');
  const re = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${pattern}(?![\\p{L}\\p{N}\\p{M}])`, 'gu');
  const spans = tokenSpans(text);
  const folded = fold(text);
  let out = '';
  let last = 0;
  for (const m of folded.matchAll(re)) {
    let start = m.index ?? 0;
    let end = start + m[0].length;
    if (spans.some(([s, e]) => start < e && end > s)) continue;
    while (start > last && text[start - 1] === '[' && text[end] === ']') {
      start--;
      end++;
    }
    out += text.slice(last, start) + token;
    last = end;
  }
  return out + text.slice(last);
}

type Replacement = { value: string; token: string };

function replacements(identity: Identity): Replacement[] {
  const list: Replacement[] = [];
  const push = (value: string | null | undefined, token: string) => {
    if (value?.trim()) list.push({ value: value.trim(), token });
  };
  for (const f of FIELDS) {
    if (f === 'firstName' && identity.revealFirstName) continue;
    push(identity[f], TOKENS[f]);
  }
  identity.links.forEach((link, i) => {
    push(link, linkToken(i));
  });
  // Les valeurs longues d'abord : « Jean-Pierre » part avant « Jean ».
  return list.sort((a, b) => b.value.length - a.value.length);
}

/**
 * Remplace chaque valeur déclarée de l'identité par son jeton, puis toute adresse électronique ou tout numéro
 * français restant. Le texte est d'abord normalisé en NFC ; un jeton déjà présent, « [NOM] », devient
 * « [[NOM]] » pour que `restore` le rende tel quel. Seule la valeur complète est reconnue : « Jean » seul
 * n'est pas masqué si le prénom déclaré est « Jean-Pierre ».
 */
export function anonymize(text: string, identity: Identity): string {
  let out = text.normalize('NFC').replace(TOKEN_RE, '[[$1]]');
  for (const r of replacements(identity)) out = replaceValue(out, r.value, r.token);
  out = out.replace(EMAIL_RE, TOKENS.email);
  out = out.replace(PHONE_RE, TOKENS.phone);
  return out;
}

const PROTECT_MARK = '\u0000';
const UNPROTECT_RE = new RegExp(`${PROTECT_MARK}(${TOKEN_ALT})${PROTECT_MARK}`, 'g');

function isBlank(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t';
}

/**
 * Remet les valeurs déclarées à la place des jetons. Perte assumée : une valeur revient dans son orthographe
 * déclarée, quelle que soit la casse du texte d'origine. `[PRENOM]` est rempli même si `revealFirstName` est
 * vrai. Un jeton sans valeur disparaît avec un blanc voisin, le reste de l'espacement est conservé.
 * `[[NOM]]` redevient le littéral `[NOM]` ; le marquage suppose un texte sans caractère NUL.
 */
export function restore(text: string, identity: Identity): string {
  const values: Record<string, string> = {};
  for (const f of FIELDS) values[FIELD_KEYS[f]] = identity[f]?.trim() ?? '';
  identity.links.forEach((link, i) => {
    values[`LIEN_${i + 1}`] = link.trim();
  });
  const src = text.replace(PROTECTED_RE, `${PROTECT_MARK}$1${PROTECT_MARK}`);
  let out = '';
  let last = 0;
  for (const m of src.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    out += src.slice(last, start);
    last = end;
    const value = values[m[1] as string] ?? '';
    if (value) {
      out += value;
    } else if (isBlank(src[end])) {
      // Blanc après le jeton (et peut-être avant) : on retire celui d'après.
      last = end + 1;
    } else if (isBlank(out[out.length - 1])) {
      out = out.slice(0, -1);
    }
  }
  out += src.slice(last);
  return out.replace(UNPROTECT_RE, '[$1]');
}
