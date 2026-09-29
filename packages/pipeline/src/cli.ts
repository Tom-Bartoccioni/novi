import { getDb } from '@novi/db';
import { Command } from 'commander';
import { log } from './lib/logger';
import { discoverWebsites } from './steps/discover-websites';
import { ingestOffres } from './steps/ingest-offres';
import { ingestSirene } from './steps/ingest-sirene';
import { matchOffres } from './steps/match-offres';

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
  .option('--force')
  .option('--limit <n>', 'nombre max', Number)
  .option('--siren <siren>')
  .action(notImplemented('crawl websites'));
program
  .command('enrich')
  .command('github')
  .option('--force')
  .option('--limit <n>', 'nombre max', Number)
  .option('--siren <siren>')
  .action(notImplemented('enrich github'));
program.command('signals').action(notImplemented('signals'));
program
  .command('run')
  .command('all')
  .option('-d, --departement <code>', 'département', '06')
  .action(notImplemented('run all'));

program.parseAsync(process.argv);
