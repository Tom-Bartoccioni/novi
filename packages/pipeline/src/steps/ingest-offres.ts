import { detectTechs, loadIngestConfig, loadTechTags } from '@novi/core';
import { crawlRuns, type Db, jobOffers, upsertCompanyTech } from '@novi/db';
import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { log } from '../lib/logger';
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
  const iterate = opts.iterate ?? (() => iterateOffers(opts.departement, config.romeDomaines));
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
          ctx.error(offer.id, err);
        }
      }
      // Expiration : offres non vues depuis EXPIRE_AFTER_RUNS runs d'ingestion d'offres.
      // Un run avec --limit ne voit qu'une partie des offres : il ne doit ni expirer, ni compter.
      if (opts.limit !== undefined) {
        log('ingest offres : run limité, expiration des offres ignorée');
        return;
      }
      // Seuls les runs précédents terminés, sans --limit et sans erreur fatale comptent (une erreur
      // fatale, levée par withRun, n'a pas de champ siren ; les erreurs par offre en ont un). Le run
      // courant (encore en cours, sans finished_at) est ajouté explicitement.
      const previousRuns = db
        .select({ id: crawlRuns.id })
        .from(crawlRuns)
        .where(
          and(
            eq(crawlRuns.command, 'ingest offres'),
            lt(crawlRuns.id, ctx.runId),
            isNotNull(crawlRuns.finishedAt),
            sql`json_extract(${crawlRuns.args}, '$.limit') is null`,
            sql`not exists (select 1 from json_each(${crawlRuns.errors}) where json_extract(value, '$.siren') is null)`,
          ),
        )
        .orderBy(desc(crawlRuns.id))
        .limit(EXPIRE_AFTER_RUNS - 1)
        .all();
      const runIds = [ctx.runId, ...previousRuns.map((r) => r.id)];
      if (runIds.length >= EXPIRE_AFTER_RUNS) {
        const threshold = Math.min(...runIds);
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
