import { detectTechs, loadIngestConfig, loadTechTags } from '@novi/core';
import { crawlRuns, type Db, jobOffers, upsertCompanyTech } from '@novi/db';
import { and, desc, eq, lt } from 'drizzle-orm';
import { type RunResult, withRun } from '../lib/run';
import { iterateOffers, type Offer, toOfferRow } from '../sources/france-travail';

export type IngestOffresOptions = {
  departement: string;
  limit?: number;
  iterate?: () => AsyncIterable<Offer>;
};

const EXPIRE_AFTER_RUNS = 3;
export const OFFER_TECH_CONFIDENCE = 0.8;

export function offerText(offer: { title: string; description?: string | null }): string {
  return `${offer.title}\n${offer.description ?? ''}`;
}

export function ingestOffres(db: Db, opts: IngestOffresOptions): Promise<RunResult> {
  const config = loadIngestConfig();
  const tags = loadTechTags();
  const iterate = opts.iterate ?? (() => iterateOffers(opts.departement, config.romeCodes));
  return withRun(
    db,
    'ingest offres',
    { departement: opts.departement, limit: opts.limit ?? null },
    async (ctx) => {
      const seen = new Set<string>();
      for await (const offer of iterate()) {
        if (opts.limit !== undefined && ctx.stats.processed >= opts.limit) break;
        if (seen.has(offer.id)) continue;
        seen.add(offer.id);
        ctx.stats.processed += 1;
        try {
          const row = toOfferRow(offer, ctx.runId);
          const existing = db
            .select({ id: jobOffers.id, siren: jobOffers.siren })
            .from(jobOffers)
            .where(eq(jobOffers.id, row.id))
            .get();
          if (existing) {
            const { id: _id, ...update } = row;
            db.update(jobOffers).set(update).where(eq(jobOffers.id, row.id)).run();
            ctx.stats.updated += 1;
            if (existing.siren) {
              upsertCompanyTech(
                db,
                existing.siren,
                'offre',
                detectTechs(offerText(row), tags, OFFER_TECH_CONFIDENCE),
              );
            }
          } else {
            db.insert(jobOffers).values(row).run();
            ctx.stats.created += 1;
          }
        } catch (err) {
          ctx.error(undefined, err);
        }
      }
      // Expiration : offres non vues depuis EXPIRE_AFTER_RUNS runs d'ingestion d'offres.
      const previousRuns = db
        .select({ id: crawlRuns.id })
        .from(crawlRuns)
        .where(eq(crawlRuns.command, 'ingest offres'))
        .orderBy(desc(crawlRuns.id))
        .limit(EXPIRE_AFTER_RUNS)
        .all();
      if (previousRuns.length >= EXPIRE_AFTER_RUNS) {
        const threshold = previousRuns[previousRuns.length - 1]?.id ?? 0;
        const expired = db
          .update(jobOffers)
          .set({ isActive: false })
          .where(and(eq(jobOffers.isActive, true), lt(jobOffers.lastSeenRunId, threshold)))
          .run();
        ctx.stats.expired = expired.changes;
      }
    },
  );
}
