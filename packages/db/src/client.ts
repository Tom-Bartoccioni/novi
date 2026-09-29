import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { distanceKm } from '@novi/core';
import Database from 'better-sqlite3';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export function findRepoRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export const DEFAULT_DB_URL = 'file:./data/novi.db';

export function resolveDbPath(url = process.env.DATABASE_URL ?? DEFAULT_DB_URL): string {
  const stripped = url.startsWith('file:') ? url.slice('file:'.length) : url;
  if (stripped === ':memory:') return stripped;
  const path = resolve(findRepoRoot(), stripped);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

export function createDb(url?: string) {
  loadEnv({ path: join(findRepoRoot(), '.env'), quiet: true });
  const sqlite = new Database(resolveDbPath(url));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.function('distance_km', { deterministic: true }, (lat1, lon1, lat2, lon2) =>
    distanceKm(
      { latitude: Number(lat1), longitude: Number(lon1) },
      { latitude: Number(lat2), longitude: Number(lon2) },
    ),
  );
  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof createDb>;

let singleton: Db | null = null;

export function getDb(): Db {
  if (!singleton) singleton = createDb();
  return singleton;
}
