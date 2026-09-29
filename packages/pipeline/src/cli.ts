import { getDb } from '@novi/db';
import { Command } from 'commander';
import { log } from './lib/logger';
import { crawlWebsites } from './steps/crawl-websites';
import { discoverWebsites } from './steps/discover-websites';
import { enrichGithub } from './steps/enrich-github';
import { ingestOffres } from './steps/ingest-offres';
import { ingestSirene } from './steps/ingest-sirene';
import { matchOffres } from './steps/match-offres';
import { computeSignals } from './steps/signals';

export const program = new Command('pipeline').description('Pipeline de données Novi');

const notImplemented = (name: string) => async () => {
  log(`${name} : non implémenté`);
};

const ingest = program.command('ingest').description('Ingestion des sources');
ingest
  .command('sirene')
  .option('-d, --departement <code>', 'département', '06')
  .option('--limit <n>', 'nombre max', Number)
  .action(async (opts: { departement: string; limit?: number }) => {
    await ingestSirene(getDb(), opts);
  });
ingest
  .command('offres')
  .option('-d, --departement <code>', 'département', '06')
  .option('--limit <n>', 'nombre max', Number)
  .action(async (opts: { departement: string; limit?: number }) => {
    await ingestOffres(getDb(), opts);
  });

program
  .command('match')
  .command('offres')
  .option('--force', 'retraiter aussi les offres déjà rattachées (ne détache jamais)')
  .action(async (opts: { force?: boolean }) => {
    await matchOffres(getDb(), opts);
  });
program
  .command('discover')
  .command('websites')
  .option('--force', 'retraiter les sites déjà trouvés automatiquement')
  .option('--limit <n>', 'nombre max', Number)
  .option('--siren <siren>', 'une seule entreprise')
  .action(async (opts: { force?: boolean; limit?: number; siren?: string }) => {
    await discoverWebsites(getDb(), opts);
  });
program
  .command('crawl')
  .command('websites')
  .option('--force', 'réanalyser même si crawlé il y a moins de 30 jours')
  .option('--limit <n>', 'nombre max', Number)
  .option('--siren <siren>', 'une seule entreprise')
  .action(async (opts: { force?: boolean; limit?: number; siren?: string }) => {
    await crawlWebsites(getDb(), opts);
  });
program
  .command('enrich')
  .command('github')
  .option('--limit <n>', 'nombre max', Number)
  .option('--siren <siren>', 'une seule entreprise')
  .action(async (opts: { limit?: number; siren?: string }) => {
    await enrichGithub(getDb(), opts);
  });
program
  .command('signals')
  .description('Recalcule les signaux dérivés')
  .action(async () => {
    await computeSignals(getDb());
  });
program
  .command('run')
  .command('all')
  .option('-d, --departement <code>', 'département', '06')
  .action(notImplemented('run all'));

program.parseAsync(process.argv);
