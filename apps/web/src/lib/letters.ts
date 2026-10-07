import {
  anonymize,
  buildLetterPrompt,
  type Identity,
  type LetterInput,
  linkToken,
  restore,
  type TextGenerator,
  TOKENS,
} from '@novi/assist';
import { loadTechTags } from '@novi/core';
import {
  type CoverLetterWithOffer,
  companies,
  companyTech,
  type Db,
  insertCoverLetter,
  jobOffers,
  type Profile,
} from '@novi/db';
import { and, eq } from 'drizzle-orm';
import { identityFromProfile } from './assist';
import { headcountLabel } from './format';

export type LetterRequest = { siren: string; offerId?: string | null; instruction?: string | null };
export type LetterOutcome = { letter: CoverLetterWithOffer; sentPrompt: string };

const MAX_TECHS_IN_PROMPT = 15;
const UNKNOWN_HEADCOUNTS = new Set(['NN', '00']);
// Libellés lisibles des sources de détection, recopiés dans le prompt (« React (offre) »).
const SOURCE_LABELS: Record<string, string> = {
  offre: 'offre',
  site: 'site',
  github: 'GitHub',
  manuel: 'manuel',
};
const tagIndex = new Map(loadTechTags().map((t) => [t.slug, t]));

function companyTechsForPrompt(db: Db, siren: string): LetterInput['company']['techs'] {
  const best = new Map<string, { confidence: number; source: string }>();
  for (const r of db.select().from(companyTech).where(eq(companyTech.siren, siren)).all()) {
    const current = best.get(r.tagSlug);
    if (!current || r.confidence > current.confidence)
      best.set(r.tagSlug, { confidence: r.confidence, source: r.source });
  }
  return [...best.entries()]
    .sort((a, b) => b[1].confidence - a[1].confidence)
    .slice(0, MAX_TECHS_IN_PROMPT)
    .map(([slug, v]) => ({
      label: tagIndex.get(slug)?.label ?? slug,
      source: SOURCE_LABELS[v.source] ?? v.source,
    }));
}

/** Ne garde que la ville d'une adresse géocodée (« 186 Avenue de Fabron 06200 Nice » → « Nice »). */
export function townOf(homeLabel: string): string {
  return homeLabel.replace(/^.*\b\d{5}\s+/, '').trim() || homeLabel.trim();
}

/** Nature d'un lien pour l'en-tête, déduite du domaine : la valeur elle-même reste masquée. */
export function linkKind(url: string): string {
  const host = url.toLowerCase();
  if (host.includes('linkedin.com')) return 'LinkedIn';
  if (host.includes('github.com')) return 'GitHub';
  if (host.includes('gitlab.com')) return 'GitLab';
  return 'site personnel';
}

/** Jetons de coordonnées effectivement disponibles pour l'en-tête, dans l'ordre d'affichage souhaité. */
export function headerTokens(identity: Identity): { token: string; kind: string }[] {
  const tokens: { token: string; kind: string }[] = [];
  if (identity.firstName || identity.lastName) {
    tokens.push({
      token: identity.revealFirstName
        ? `${identity.firstName ?? ''} ${TOKENS.lastName}`.trim()
        : `${TOKENS.firstName} ${TOKENS.lastName}`,
      kind: 'nom complet',
    });
  }
  if (identity.postalAddress) tokens.push({ token: TOKENS.postalAddress, kind: 'adresse postale' });
  if (identity.email) tokens.push({ token: TOKENS.email, kind: 'e-mail' });
  if (identity.phone) tokens.push({ token: TOKENS.phone, kind: 'téléphone' });
  identity.links.forEach((link, i) => {
    tokens.push({ token: linkToken(i), kind: linkKind(link) });
  });
  return tokens;
}

/** « 7 octobre 2026 », pour la ligne de date de la lettre. */
export function formatLetterDate(now: Date): string {
  return now.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  });
}

export async function generateLetterFor(
  db: Db,
  profile: Profile,
  request: LetterRequest,
  generator: TextGenerator,
  now: Date = new Date(),
): Promise<LetterOutcome> {
  if (!profile.cvText) throw new Error('Importez votre CV dans le profil pour générer des lettres');
  const identity = identityFromProfile(profile);
  if (!identity.lastName) {
    throw new Error(
      'Renseignez votre nom dans le profil : sans lui, le CV ne peut pas être anonymisé avant envoi',
    );
  }
  // Sans prénom connu, celui écrit dans le CV ne serait pas masqué : il partirait en clair.
  if (!identity.firstName && !identity.revealFirstName) {
    throw new Error('Renseignez votre prénom dans le profil, ou cochez « Laisser passer mon prénom au LLM »');
  }
  const company = db.select().from(companies).where(eq(companies.siren, request.siren)).get();
  if (!company) throw new Error(`Entreprise inconnue : ${request.siren}`);
  const offer = request.offerId
    ? db
        .select()
        .from(jobOffers)
        .where(and(eq(jobOffers.id, request.offerId), eq(jobOffers.siren, request.siren)))
        .get()
    : undefined;
  if (request.offerId && !offer) throw new Error('Offre inconnue pour cette entreprise');
  // Tout texte libre susceptible de contenir une donnée personnelle passe par ici avant le prompt.
  const mask = (text: string | null | undefined) => (text ? anonymize(text, identity) : null);
  const town = mask(townOf(profile.homeLabel)) ?? '';
  const input: LetterInput = {
    profile: { homeLabel: town, skills: profile.skills },
    header: { date: formatLetterDate(now), town, tokens: headerTokens(identity) },
    cvText: anonymize(profile.cvText, identity),
    company: {
      name: company.name,
      city: company.city,
      headcountLabel:
        company.headcountRange && !UNKNOWN_HEADCOUNTS.has(company.headcountRange)
          ? headcountLabel(company.headcountRange)
          : null,
      description: company.description,
      techs: companyTechsForPrompt(db, company.siren),
      careersUrl: company.careersUrl,
      website: company.website,
    },
    offer: offer
      ? {
          title: offer.title,
          contractType: offer.contractType,
          description: mask(offer.description),
          city: offer.city,
        }
      : undefined,
    instruction: mask(request.instruction) ?? undefined,
    revealFirstName: identity.revealFirstName,
  };
  const prompt = buildLetterPrompt(input);
  const { text } = await generator.generate(prompt);
  const content = restore(text, identity);
  const row = insertCoverLetter(db, {
    profileId: profile.id,
    siren: company.siren,
    offerId: offer?.id ?? null,
    instruction: request.instruction?.trim() || null,
    content,
    model: generator.label,
  });
  return {
    letter: {
      id: row.id,
      offerId: row.offerId,
      offerTitle: offer?.title ?? null,
      instruction: row.instruction,
      content: row.content,
      model: row.model,
      createdAt: row.createdAt,
    },
    sentPrompt: prompt.prompt,
  };
}
