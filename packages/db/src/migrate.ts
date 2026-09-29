import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTechTags } from '@novi/core';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { type Db, getDb, resolveDbPath } from './client';
import { ensureDefaultProfile, syncTechTags } from './queries';

const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', 'drizzle');

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

export function seed(db: Db): void {
  syncTechTags(db, loadTechTags());
  ensureDefaultProfile(db);
}

export function migrateAndSeed(db: Db): void {
  runMigrations(db);
  seed(db);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = getDb();
  migrateAndSeed(db);
  console.log(`Base migrée et initialisée : ${resolveDbPath()}`);
}
