import { companies, type Db, type Finances, jobOffers, replaceSignals, type SignalKind } from '@novi/db';
import { eq } from 'drizzle-orm';
import { type RunResult, withRun } from '../lib/run';

const DERIVED: SignalKind[] = [
  'recruiting_now',
  'hired_last_12_months',
  'careers_page_found',
  'revenue_growth',
];

export function revenueGrowth(
  finances: Finances | null | undefined,
): { percent: number; years: [string, string] } | null {
  if (!finances) return null;
  const years = Object.entries(finances)
    .filter(([, v]) => typeof v.ca === 'number' && v.ca !== null)
    .map(([y, v]) => [y, v.ca as number] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const [previous, latest] = years.slice(-2);
  if (!previous || !latest) return null;
  const [prevYear, prev] = previous;
  const [lastYear, last] = latest;
  if (prev <= 0) return null;
  return { percent: Math.round(((last - prev) / prev) * 100), years: [prevYear, lastYear] };
}

export type SignalsOptions = { now?: Date };

export function computeSignals(db: Db, opts: SignalsOptions = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString();
  return withRun(db, 'signals', {}, async (ctx) => {
    const all = db
      .select({ siren: companies.siren, careersUrl: companies.careersUrl, finances: companies.finances })
      .from(companies)
      .all();
    for (const c of all) {
      ctx.stats.processed += 1;
      try {
        const offers = db
          .select({ isActive: jobOffers.isActive, publishedAt: jobOffers.publishedAt })
          .from(jobOffers)
          .where(eq(jobOffers.siren, c.siren))
          .all();
        const active = offers.filter((o) => o.isActive).length;
        const lastYear = offers.filter((o) => o.publishedAt && o.publishedAt >= oneYearAgo).length;
        const rows: { kind: SignalKind; value: number | null; evidence: string | null }[] = [];
        if (active > 0)
          rows.push({
            kind: 'recruiting_now',
            value: active,
            evidence: `${active} offre${active > 1 ? 's' : ''} active${active > 1 ? 's' : ''}`,
          });
        if (lastYear > 0)
          rows.push({
            kind: 'hired_last_12_months',
            value: lastYear,
            evidence: `${lastYear} offre${lastYear > 1 ? 's' : ''} sur 12 mois`,
          });
        if (c.careersUrl) rows.push({ kind: 'careers_page_found', value: 1, evidence: c.careersUrl });
        const growth = revenueGrowth(c.finances);
        if (growth)
          rows.push({
            kind: 'revenue_growth',
            value: growth.percent,
            evidence: `CA ${growth.years[0]} → ${growth.years[1]} : ${growth.percent > 0 ? '+' : ''}${growth.percent} %`,
          });
        replaceSignals(db, c.siren, DERIVED, rows);
        ctx.stats.updated += 1;
      } catch (err) {
        ctx.error(c.siren, err);
      }
    }
  });
}
