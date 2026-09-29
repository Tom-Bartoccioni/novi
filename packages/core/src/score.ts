import { HEADCOUNT_LABELS } from './config';
import type { ScoreCompany, ScoreLine, ScoreProfile, ScoreResult } from './types';

const TECH_MAX = 40;
const TECH_CONFIDENCE_CAP = 4;
const DISTANCE_MAX = 20;
const HEADCOUNT_MAX = 15;
const OFFER_MATCH = 15;
const OFFER_NO_MATCH = 8;
const SIGNALS_MAX = 10;
const ESN_PENALTY = -20;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function scoreCompany(profile: ScoreProfile, company: ScoreCompany, distanceKm: number): ScoreResult {
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
  if (profile.radiusKm > 0 && distanceKm < profile.radiusKm) {
    const points = round1(DISTANCE_MAX * (1 - distanceKm / profile.radiusKm));
    lines.push({ label: `${Math.round(distanceKm)} km`, points });
  }

  // Taille.
  if (company.headcountRange && profile.headcountRanges.includes(company.headcountRange)) {
    const label = HEADCOUNT_LABELS[company.headcountRange] ?? company.headcountRange;
    lines.push({ label: `Taille souhaitée (${label})`, points: HEADCOUNT_MAX });
  }

  // Offres actives.
  const active = company.activeOffers.length;
  if (active > 0) {
    const matching = company.activeOffers.filter((o) => o.techSlugs.some((s) => skills.has(s))).length;
    if (matching > 0) {
      lines.push({
        label: `${matching} offre${matching > 1 ? 's' : ''} active${matching > 1 ? 's' : ''} correspondant au profil`,
        points: OFFER_MATCH,
      });
    } else {
      lines.push({
        label: `${active} offre${active > 1 ? 's' : ''} active${active > 1 ? 's' : ''}`,
        points: OFFER_NO_MATCH,
      });
    }
  }

  // Signaux récents, plafonnés.
  let signalPoints = 0;
  const signalLines: ScoreLine[] = [];
  for (const s of company.signals) {
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
