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
