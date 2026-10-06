import { HEADCOUNT_LABELS } from './config';
import type { ScoreCompany, ScoreLine, ScoreProfile, ScoreResult } from './types';

const TECH_MAX = 40;
const TECH_CONFIDENCE_CAP = 4;
const DISTANCE_MAX = 20;
const HEADCOUNT_MAX = 15;
const OFFER_MATCH = 15;
const OFFER_MATCH_RECENT = 20;
const OFFER_NO_MATCH = 8;
const OFFER_NO_MATCH_RECENT = 10;
export const DEFAULT_NEW_OFFER_DAYS = 7;
const SIGNALS_MAX = 10;
const ESN_PENALTY = -20;

/** Vrai si l'offre a été publiée il y a moins de `days` jours. Dates invalides ou absentes : faux. */
export function isRecentOffer(
  publishedAt: string | null | undefined,
  days: number,
  now: Date = new Date(),
): boolean {
  if (!publishedAt || days <= 0) return false;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return false;
  return now.getTime() - t < days * 24 * 60 * 60 * 1000;
}

function plural(n: number): string {
  return n > 1 ? 's' : '';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function scoreCompany(
  profile: ScoreProfile,
  company: ScoreCompany,
  distanceKm: number,
  now: Date = new Date(),
): ScoreResult {
  const lines: ScoreLine[] = [];
  const skills = new Set(profile.skills);

  // Technos communes : meilleure confiance par slug, somme plafonnée.
  const best = new Map<string, number>();
  for (const t of company.techs) {
    if (!skills.has(t.slug)) continue;
    best.set(t.slug, Math.max(best.get(t.slug) ?? 0, t.confidence));
  }
  if (best.size > 0) {
    const sum = Math.min(
      TECH_CONFIDENCE_CAP,
      [...best.values()].reduce((a, b) => a + b, 0),
    );
    const points = round1((sum / TECH_CONFIDENCE_CAP) * TECH_MAX);
    lines.push({
      label: `${best.size} techno${best.size > 1 ? 's' : ''} commune${best.size > 1 ? 's' : ''}`,
      points,
    });
  }

  // Proximité.
  const clampedDistanceKm = Math.max(0, distanceKm);
  if (profile.radiusKm > 0 && clampedDistanceKm < profile.radiusKm) {
    const points = round1(DISTANCE_MAX * (1 - clampedDistanceKm / profile.radiusKm));
    lines.push({ label: `${Math.round(clampedDistanceKm)} km`, points });
  }

  // Taille.
  if (company.headcountRange && profile.headcountRanges.includes(company.headcountRange)) {
    const label = HEADCOUNT_LABELS[company.headcountRange] ?? company.headcountRange;
    lines.push({ label: `Taille souhaitée (${label})`, points: HEADCOUNT_MAX });
  }

  // Offres actives : une offre correspondant au profil compte plus, une offre récente encore plus.
  const active = company.activeOffers.length;
  if (active > 0) {
    const days = profile.newOfferDays ?? DEFAULT_NEW_OFFER_DAYS;
    const isMatching = (o: { techSlugs: string[] }) => o.techSlugs.some((s) => skills.has(s));
    const recent = company.activeOffers.filter((o) => isRecentOffer(o.publishedAt, days, now));
    const recentMatching = recent.filter(isMatching).length;
    const matching = company.activeOffers.filter(isMatching).length;
    if (recentMatching > 0) {
      const n = recentMatching;
      lines.push({
        label: `${n} offre${plural(n)} récente${plural(n)} correspondant au profil`,
        points: OFFER_MATCH_RECENT,
      });
    } else if (matching > 0) {
      const n = matching;
      lines.push({
        label: `${n} offre${plural(n)} active${plural(n)} correspondant au profil`,
        points: OFFER_MATCH,
      });
    } else if (recent.length > 0) {
      const k = recent.length;
      const tail = k === 1 ? 'dont une récente' : `dont ${k} récentes`;
      lines.push({
        label: `${active} offre${plural(active)} active${plural(active)}, ${tail}`,
        points: OFFER_NO_MATCH_RECENT,
      });
    } else {
      lines.push({
        label: `${active} offre${plural(active)} active${plural(active)}`,
        points: OFFER_NO_MATCH,
      });
    }
  }

  // Signaux récents, plafonnés (une ligne par nature de signal, première occurrence).
  const seenKinds = new Set<string>();
  const dedupedSignals = company.signals.filter((s) => {
    if (seenKinds.has(s.kind)) return false;
    seenKinds.add(s.kind);
    return true;
  });
  let signalPoints = 0;
  const signalLines: ScoreLine[] = [];
  for (const s of dedupedSignals) {
    if (s.kind === 'hired_last_12_months' && (s.value ?? 0) > 0) {
      signalLines.push({
        label: `A recruté sur 12 mois (${s.value} offre${(s.value ?? 0) > 1 ? 's' : ''})`,
        points: 4,
      });
    } else if (s.kind === 'github_active') {
      signalLines.push({ label: 'GitHub actif', points: 3 });
    } else if (s.kind === 'revenue_growth' && (s.value ?? 0) > 0) {
      signalLines.push({ label: `Chiffre d’affaires en hausse (+${Math.round(s.value ?? 0)} %)`, points: 3 });
    }
  }
  for (const l of signalLines) {
    if (signalPoints >= SIGNALS_MAX) break;
    const points = Math.min(l.points, SIGNALS_MAX - signalPoints);
    signalPoints += points;
    lines.push({ ...l, points });
  }

  // ESN.
  if (company.signals.some((s) => s.kind === 'esn_suspected')) {
    lines.push({ label: 'ESN suspectée', points: ESN_PENALTY });
  }

  const total = lines.reduce((a, l) => a + l.points, 0);
  return { score: Math.max(0, Math.round(total)), lines };
}
