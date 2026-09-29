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
  await ingestSirene(db, { departement: opts.departement });
  if (hasCredentials()) {
    await ingestOffres(db, { departement: opts.departement });
    await matchOffres(db, {});
  } else {
    warn('Identifiants France Travail absents : étapes offres et match ignorées');
  }
  await discoverWebsites(db, {});
  await crawlWebsites(db, {});
  await enrichGithub(db, {});
  await computeSignals(db);
  log('Pipeline complet terminé');
}
