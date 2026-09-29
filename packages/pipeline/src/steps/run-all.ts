import type { Db } from '@novi/db';
import { log, warn } from '../lib/logger';
import { hasCredentials } from '../sources/france-travail';
import { crawlWebsites } from './crawl-websites';
import { discoverWebsites } from './discover-websites';
import { enrichGithub } from './enrich-github';
import { ingestOffres } from './ingest-offres';
import { ingestSirene } from './ingest-sirene';
import { matchOffres } from './match-offres';
import { computeSignals } from './signals';

export async function runAll(db: Db, opts: { departement: string }): Promise<void> {
  const failed: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warn(`étape ${name} échouée : ${message}`);
      failed.push(name);
    }
  };
  await step('ingest sirene', () => ingestSirene(db, { departement: opts.departement }));
  if (hasCredentials()) {
    await step('ingest offres', () => ingestOffres(db, { departement: opts.departement }));
    await step('match offres', () => matchOffres(db, {}));
  } else {
    warn('Identifiants France Travail absents : étapes offres et match ignorées');
  }
  await step('discover websites', () => discoverWebsites(db, {}));
  await step('crawl websites', () => crawlWebsites(db, {}));
  await step('enrich github', () => enrichGithub(db, {}));
  await step('signals', () => computeSignals(db));
  if (failed.length > 0) {
    process.exitCode = 1;
    warn(`Pipeline terminé avec ${failed.length} étape(s) en échec : ${failed.join(', ')}`);
  } else {
    log('Pipeline complet terminé');
  }
}
