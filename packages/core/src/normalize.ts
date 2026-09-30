export const LEGAL_FORMS = [
  'sasu',
  'sas',
  'sarl',
  'eurl',
  'scop',
  'sa',
  'snc',
  'sci',
  'selarl',
  'se',
  'gie',
  'societe par actions simplifiee',
  'societe a responsabilite limitee',
  'entreprise unipersonnelle a responsabilite limitee',
];

const STOP_WORDS = new Set([
  'les',
  'des',
  'the',
  'and',
  'pour',
  'avec',
  'sur',
  'sous',
  'dans',
  'par',
  'une',
  'group',
  'groupe',
  'company',
  'compagnie',
  'societe',
  'entreprise',
  'france',
  'web',
  'pro',
  'tech',
  'digital',
  'solutions',
  'services',
  'consulting',
  'conseil',
  'studio',
  'agency',
  'agence',
  'software',
  'logiciel',
  'logiciels',
  'informatique',
  'systems',
  'system',
  'systemes',
  'technologies',
  'technology',
  'holding',
  'mediterranee',
  'riviera',
  'azur',
  'international',
  'partners',
  'network',
  'networks',
  'data',
  'cloud',
  'apps',
  'labs',
  'lab',
]);

export function stripAccents(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function basicClean(input: string): string {
  return stripAccents(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeCompanyName(name: string): string {
  // "S.A.R.L." -> "sarl" before punctuation is turned into spaces
  const dotted = name.replace(/\b([a-zA-Z])\.(?=[a-zA-Z]\.)/g, '$1').replace(/\b([a-zA-Z]{2,5})\./g, '$1 ');
  const cleaned = basicClean(dotted);
  const words = cleaned.split(' ').filter((w) => w.length > 0 && !LEGAL_FORMS.includes(w));
  let result = words.join(' ');
  for (const form of LEGAL_FORMS.filter((f) => f.includes(' '))) {
    result = result.replace(form, ' ');
  }
  return result.trim().replace(/\s+/g, ' ');
}

export function slugify(name: string): string {
  return normalizeCompanyName(name).replace(/\s+/g, '');
}

export function significantWords(name: string): string[] {
  return normalizeCompanyName(name)
    .split(' ')
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
}
