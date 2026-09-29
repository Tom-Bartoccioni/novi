import { join } from 'node:path';
import { findRepoRoot } from '@novi/db';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: join(findRepoRoot(), '.env'), quiet: true });

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name} (voir .env.example)`);
  return value;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}
