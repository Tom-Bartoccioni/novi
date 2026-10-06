import { type Db, jobOffers } from '@novi/db';
import { gte, sql } from 'drizzle-orm';
import { log, warn } from '../lib/logger';
import { type RunResult, withRun } from '../lib/run';
import { hasCredentials as defaultHasCredentials } from '../sources/france-travail';
import { ingestOffres as defaultIngestOffres } from './ingest-offres';
import { matchOffres as defaultMatchOffres } from './match-offres';
import { computeSignals as defaultComputeSignals } from './signals';

export type RefreshOptions = { departement: string };

export type RefreshSteps = {
  hasCredentials: () => boolean;
  ingestOffres: (db: Db, opts: { departement: string }) => Promise<RunResult>;
  matchOffres: (db: Db, opts: { force?: boolean }) => Promise<RunResult>;
  computeSignals: (db: Db) => Promise<RunResult>;
};

export type RefreshResult = { newOffers: number; linked: number; failed: string[] };

const DEFAULT_STEPS: RefreshSteps = {
  hasCredentials: defaultHasCredentials,
  ingestOffres: defaultIngestOffres,
  matchOffres: defaultMatchOffres,
  computeSignals: defaultComputeSignals,
};

/**
 * Rafraîchissement léger destiné à la planification : offres France Travail, rattachement, signaux.
 * Chaque sous-étape garde son propre run ; un run `refresh` englobant porte le résumé.
 */
export async function refresh(
  db: Db,
  opts: RefreshOptions,
  steps: RefreshSteps = DEFAULT_STEPS,
): Promise<RefreshResult> {
  if (!steps.hasCredentials()) {
    warn('Identifiants France Travail absents : refresh impossible (voir .env.example)');
    process.exitCode = 1;
    return { newOffers: 0, linked: 0, failed: ['credentials'] };
  }
  const startedAt = new Date().toISOString();
  const failed: string[] = [];
  let linked = 0;
  const result = await withRun(db, 'refresh', { departement: opts.departement }, async (ctx) => {
    // Une sous-étape en échec est journalisée puis on continue : withRun ne lève donc jamais ici.
    const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (err) {
        failed.push(name);
        ctx.error(undefined, err);
        return undefined;
      }
    };
    await step('ingest offres', () => steps.ingestOffres(db, { departement: opts.departement }));
    const match = await step('match offres', () => steps.matchOffres(db, {}));
    linked = Number(match?.stats.matched ?? 0);
    await step('signals', () => steps.computeSignals(db));
    const fresh = db
      .select({ n: sql<number>`count(*)` })
      .from(jobOffers)
      .where(gte(jobOffers.createdAt, startedAt))
      .get();
    ctx.stats.newOffers = fresh?.n ?? 0;
    ctx.stats.linked = linked;
    ctx.stats.processed = ctx.stats.newOffers;
  });
  const newOffers = Number(result.stats.newOffers ?? 0);
  if (failed.length > 0) {
    process.exitCode = 1;
    warn(`Refresh terminé avec ${failed.length} étape(s) en échec : ${failed.join(', ')}`);
  } else {
    log(`Refresh terminé : ${newOffers} nouvelle(s) offre(s), ${linked} rattachée(s)`);
  }
  return { newOffers, linked, failed };
}
