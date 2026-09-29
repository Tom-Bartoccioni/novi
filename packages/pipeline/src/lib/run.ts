import { crawlRuns, type Db, type RunError, type RunStats } from '@novi/db';
import { eq } from 'drizzle-orm';
import { log, warn } from './logger';

export type RunContext = {
  runId: number;
  stats: RunStats;
  errors: RunError[];
  error: (siren: string | undefined, err: unknown) => void;
};

export type RunResult = { runId: number; stats: RunStats; errors: RunError[] };

export function emptyStats(): RunStats {
  return { processed: 0, created: 0, updated: 0, errors: 0 };
}

export async function withRun(
  db: Db,
  command: string,
  args: Record<string, unknown>,
  step: (ctx: RunContext) => Promise<void>,
): Promise<RunResult> {
  const run = db.insert(crawlRuns).values({ command, args }).returning({ id: crawlRuns.id }).get();
  const stats = emptyStats();
  const errors: RunError[] = [];
  const ctx: RunContext = {
    runId: run.id,
    stats,
    errors,
    error: (siren, err) => {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(siren ? { siren, message } : { message });
      stats.errors = errors.length;
      warn(`${siren ?? '-'} : ${message}`);
    },
  };
  log(`▶ ${command} ${JSON.stringify(args)}`);
  try {
    await step(ctx);
  } catch (err) {
    ctx.error(undefined, err);
    throw err;
  } finally {
    stats.errors = errors.length;
    db.update(crawlRuns)
      .set({ finishedAt: new Date().toISOString(), stats, errors })
      .where(eq(crawlRuns.id, run.id))
      .run();
    log(`■ ${command} terminé : ${JSON.stringify(stats)}`);
  }
  return { runId: run.id, stats, errors };
}
