import { loadIngestConfig } from '@novi/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { NotesField, StatusSelect, WebsiteField } from '@/components/company-actions';
import { ScoreLines } from '@/components/score-lines';
import { TechBadge } from '@/components/tech-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCompanyDetail } from '@/lib/data';
import { db, getProfile } from '@/lib/db';
import { formatDate, formatDistance, formatEuros, headcountLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

const NAF_LABELS = loadIngestConfig().nafLabels;
const CATEGORY_LABELS: Record<string, string> = {
  language: 'Langages',
  framework: 'Frameworks',
  database: 'Bases de données',
  cloud: 'Cloud et hébergement',
  tool: 'Outils',
  domain: 'Domaines',
};
const SOURCE_LABELS: Record<string, string> = {
  offre: 'offre',
  site: 'site web',
  github: 'GitHub',
  manuel: 'manuel',
};
const SIGNAL_LABELS: Record<string, string> = {
  recruiting_now: 'Recrute actuellement',
  hired_last_12_months: 'A recruté sur 12 mois',
  careers_page_found: 'Page carrière',
  github_active: 'GitHub actif',
  revenue_growth: 'Évolution du chiffre d’affaires',
  esn_suspected: 'ESN suspectée',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">{children}</CardContent>
    </Card>
  );
}

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  );
}

export default async function CompanyPage({ params }: { params: Promise<{ siren: string }> }) {
  const { siren } = await params;
  const profile = getProfile();
  const detail = getCompanyDetail(db(), profile, siren);
  if (!detail) notFound();
  const { company, distanceKm, techGroups, activeOffers, signals, score, status, notes, links } = detail;
  const nafLabel = company.nafLabel ?? NAF_LABELS[company.nafCode] ?? company.nafCode;
  const financeYears = Object.entries(company.finances ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← Explorer
        </Link>
        <h1 className="text-2xl font-semibold">{company.name}</h1>
        {company.legalName !== company.name && (
          <p className="text-sm text-muted-foreground">{company.legalName}</p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Identité">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Activité</dt>
              <dd>
                {nafLabel} ({company.nafCode})
              </dd>
              <dt className="text-muted-foreground">Effectif</dt>
              <dd>
                {headcountLabel(company.headcountRange)}
                {company.headcountYear ? ` (${company.headcountYear})` : ''}
                {company.companyCategory ? ` · ${company.companyCategory}` : ''}
              </dd>
              <dt className="text-muted-foreground">Création</dt>
              <dd>{formatDate(company.foundedAt)}</dd>
              <dt className="text-muted-foreground">Adresse</dt>
              <dd>
                {company.address ?? '—'} {company.postalCode} {company.city}
                {!company.headquartersInZone && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    (établissement local, siège ailleurs)
                  </span>
                )}
              </dd>
              <dt className="text-muted-foreground">Distance</dt>
              <dd>
                {formatDistance(distanceKm)} depuis {profile.homeLabel} ·{' '}
                <External href={links.itinerary}>itinéraire</External>
              </dd>
            </dl>
            {company.description && <p className="mt-3 text-muted-foreground">{company.description}</p>}
          </Section>

          <Section title="Présence en ligne">
            <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
              {company.website && (
                <li>
                  <External href={company.website}>Site web</External>{' '}
                  <span className="text-xs text-muted-foreground">({company.websiteSource})</span>
                </li>
              )}
              {company.careersUrl && (
                <li>
                  <External href={company.careersUrl}>Page carrière</External>
                </li>
              )}
              {company.githubOrg && (
                <li>
                  <External href={`https://github.com/${company.githubOrg}`}>GitHub</External>
                </li>
              )}
              {company.linkedinUrl ? (
                <li>
                  <External href={company.linkedinUrl}>LinkedIn</External>
                </li>
              ) : (
                <li>
                  <External href={links.linkedinSearch}>Chercher sur LinkedIn</External>
                </li>
              )}
              <li>
                <External href={links.googleSearch}>Chercher sur Google</External>
              </li>
            </ul>
            <WebsiteField siren={company.siren} website={company.website} canAnalyze={!!company.website} />
            {company.lastCrawledAt && (
              <p className="mt-1 text-xs text-muted-foreground">
                Dernière analyse : {formatDate(company.lastCrawledAt)}
              </p>
            )}
          </Section>

          <Section title="Stack détectée">
            {techGroups.length === 0 ? (
              <p className="text-muted-foreground">
                Rien de détecté pour l'instant. Renseigner le site web puis « Analyser le site ».
              </p>
            ) : (
              <div className="space-y-3">
                {techGroups.map((g) => (
                  <div key={g.category}>
                    <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                      {CATEGORY_LABELS[g.category]}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {g.techs.map((t) => (
                        <span key={t.slug} className="inline-flex items-center gap-1">
                          <TechBadge
                            label={t.label}
                            highlighted={t.inProfile}
                            confidence={Math.max(...t.sources.map((s) => s.confidence))}
                            title={t.sources
                              .map(
                                (s) =>
                                  `${SOURCE_LABELS[s.source] ?? s.source} (${Math.round(s.confidence * 100)} %) : ${s.evidence ?? ''}`,
                              )
                              .join('\n')}
                          />
                          <span className="text-[10px] text-muted-foreground">
                            {t.sources.map((s) => SOURCE_LABELS[s.source] ?? s.source).join(', ')}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title={`Offres actives (${activeOffers.length})`}>
            {activeOffers.length === 0 ? (
              <p className="text-muted-foreground">
                Aucune offre active connue. Candidature spontanée potentiellement pertinente.
              </p>
            ) : (
              <ul className="space-y-1">
                {activeOffers.map((o) => (
                  <li key={o.id}>
                    {o.url ? <External href={o.url}>{o.title}</External> : o.title}
                    <span className="text-muted-foreground">
                      {' '}
                      · {o.contractType ?? '—'} · {formatDate(o.publishedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Signaux">
            {signals.length === 0 && financeYears.length === 0 ? (
              <p className="text-muted-foreground">Aucun signal.</p>
            ) : (
              <>
                <ul className="space-y-1">
                  {signals.map((s) => (
                    <li key={`${s.kind}-${s.detectedAt}`} className="flex justify-between gap-4">
                      <span>
                        {SIGNAL_LABELS[s.kind] ?? s.kind}
                        {s.evidence ? <span className="text-muted-foreground"> — {s.evidence}</span> : null}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(s.detectedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
                {financeYears.length > 0 && (
                  <table className="mt-3 text-xs">
                    <thead>
                      <tr>
                        <th className="pr-4 text-left font-medium">Année</th>
                        <th className="pr-4 text-left font-medium">CA</th>
                        <th className="text-left font-medium">Résultat net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {financeYears.map(([year, f]) => (
                        <tr key={year}>
                          <td className="pr-4">{year}</td>
                          <td className="pr-4 tabular-nums">{formatEuros(f.ca)}</td>
                          <td className="tabular-nums">{formatEuros(f.resultat_net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Pourquoi cette entreprise">
            <ScoreLines score={score} />
          </Section>
          <Section title="Actions">
            <div className="space-y-3">
              <StatusSelect key={status} siren={company.siren} status={status} />
              <NotesField siren={company.siren} notes={notes} />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
