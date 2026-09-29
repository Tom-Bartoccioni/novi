import { stripAccents } from './normalize';
import type { Detection, TechTag } from './types';

const MAX_EVIDENCE = 200;

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function fold(input: string): string {
  return stripAccents(input).toLowerCase();
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Frontière de mot stricte des deux côtés, tolérante aux caractères comme "#" ou "+" en fin d'alias. */
function aliasRegex(alias: string): RegExp {
  const escaped = escapeRegex(fold(alias));
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9+#])`, 'i');
}

type CompiledTag = { tag: TechTag; aliases: RegExp[]; context: string[] | null };

const cache = new WeakMap<TechTag[], CompiledTag[]>();

function compile(tags: TechTag[]): CompiledTag[] {
  const cached = cache.get(tags);
  if (cached) return cached;
  const compiled = tags.map((tag) => ({
    tag,
    aliases: tag.aliases.map(aliasRegex),
    context: tag.contextRequired ? tag.contextRequired.map(fold) : null,
  }));
  cache.set(tags, compiled);
  return compiled;
}

function truncate(sentence: string): string {
  return sentence.length > MAX_EVIDENCE ? `${sentence.slice(0, MAX_EVIDENCE - 1)}…` : sentence;
}

/** Détecte les technos d'un texte visible, phrase par phrase. Une entrée par slug, première preuve. */
export function detectTechs(text: string, tags: TechTag[], confidence: number): Detection[] {
  const found = new Map<string, Detection>();
  const compiled = compile(tags);
  for (const sentence of splitSentences(text)) {
    const folded = fold(sentence);
    for (const { tag, aliases, context } of compiled) {
      if (found.has(tag.slug)) continue;
      if (!aliases.some((re) => re.test(folded))) continue;
      if (context && !context.some((c) => folded.includes(c))) continue;
      found.set(tag.slug, { slug: tag.slug, evidence: truncate(sentence), confidence });
    }
  }
  return [...found.values()];
}

/** Détecte les technos par empreintes dans le HTML brut et les en-têtes HTTP. */
export function detectFingerprints(
  html: string,
  headers: Record<string, string>,
  tags: TechTag[],
): Detection[] {
  const haystack = html.toLowerCase();
  const headerLines = Object.entries(headers).map(([k, v]) => `${k.toLowerCase()}: ${v.toLowerCase()}`);
  const found: Detection[] = [];
  for (const tag of tags) {
    if (!tag.fingerprints || tag.fingerprints.length === 0) continue;
    const hit = tag.fingerprints.find(
      (fp) => haystack.includes(fp) || headerLines.some((h) => h.includes(fp)),
    );
    if (hit) found.push({ slug: tag.slug, evidence: `empreinte : ${hit}`, confidence: 0.9 });
  }
  return found;
}

/** Fusionne plusieurs listes en gardant, par slug, la meilleure confiance. */
export function mergeDetections(...lists: Detection[][]): Detection[] {
  const best = new Map<string, Detection>();
  for (const list of lists) {
    for (const d of list) {
      const current = best.get(d.slug);
      if (!current || d.confidence > current.confidence) best.set(d.slug, d);
    }
  }
  return [...best.values()];
}

const esnCache = new WeakMap<string[], RegExp[]>();

function compileEsnKeywords(keywords: string[]): RegExp[] {
  const cached = esnCache.get(keywords);
  if (cached) return cached;
  const compiled = keywords.map(aliasRegex);
  esnCache.set(keywords, compiled);
  return compiled;
}

/** Renvoie la première phrase contenant un mot-clé ESN, sinon null. */
export function detectEsn(text: string, keywords: string[]): string | null {
  const regexes = compileEsnKeywords(keywords);
  for (const sentence of splitSentences(text)) {
    const folded = fold(sentence);
    if (regexes.some((re) => re.test(folded))) return truncate(sentence);
  }
  return null;
}
