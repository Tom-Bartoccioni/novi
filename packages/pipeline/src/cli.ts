import { getDb } from '@novi/db';
import { Command } from 'commander';
import { log } from './lib/logger';
import { ingestSirene } from './steps/ingest-sirene';

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
  .action(notImplemented('ingest offres'));

program.command('match').command('offres').option('--force').action(notImplemented('match offres'));
program
  .command('discover')
  .command('websites')
  .option('--force')
  .option('--limit <n>', 'nombre max', Number)
  .option('--siren <siren>')
  .action(notImplemented('discover websites'));
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
