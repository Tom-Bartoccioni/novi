import { HEADCOUNT_LABELS } from '@novi/core';

export function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Date et heure courtes, à l'heure locale : « 06/10/2026 08:01 ». */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

/** « il y a N min » sous une heure, « il y a N h » sous 48 h, sinon la date (dates futures comprises). */
export function formatRelativeHours(iso: string | null | undefined, now: Date = new Date()): string {
  const t = iso ? Date.parse(iso) : Number.NaN;
  const minutes = Math.floor((now.getTime() - t) / 60_000);
  if (Number.isNaN(minutes) || minutes < 0) return formatDate(iso);
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 48 * 60) return `il y a ${Math.floor(minutes / 60)} h`;
  return formatDate(iso);
}

export function headcountLabel(code: string | null | undefined): string {
  return code ? (HEADCOUNT_LABELS[code] ?? code) : 'Effectif inconnu';
}

export function linkedinSearchUrl(name: string): string {
  return `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(name)}`;
}

export function googleSearchUrl(name: string, city: string | null): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${name} ${city ?? ''}`.trim())}`;
}

export function itineraryUrl(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): string {
  return `https://www.google.com/maps/dir/${from.latitude},${from.longitude}/${to.latitude},${to.longitude}`;
}

export function formatEuros(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(n);
}

const isAllCaps = (word: string) =>
  word.toLocaleUpperCase('fr') === word && word.toLocaleLowerCase('fr') !== word;

/**
 * Découpe un nom lu dans un CV en prénom et nom. Les mots en capitales placés en tête
 * (« DUPONT Jean », « LE GALL Yann ») forment le nom ; sinon le premier mot est le prénom.
 */
export function splitFullName(full: string): { firstName: string; lastName: string } {
  const words = full.trim().split(/\s+/).filter(Boolean);
  const lead = words.findIndex((w) => !isAllCaps(w));
  if (lead > 0) return { firstName: words.slice(lead).join(' '), lastName: words.slice(0, lead).join(' ') };
  return { firstName: words[0] ?? '', lastName: words.slice(1).join(' ') };
}
