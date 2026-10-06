import { join } from 'node:path';
import { describeGenerator, type GeneratorStatus, type Identity, type LlmEnv } from '@novi/assist';
import { findRepoRoot, type Profile } from '@novi/db';
import { config as loadEnv } from 'dotenv';

// Next.js ne lit que le .env de apps/web ; celui du dépôt porte les variables LLM_*.
loadEnv({ path: join(findRepoRoot(), '.env'), quiet: true });

export function llmStatus(): GeneratorStatus {
  return describeGenerator(process.env as LlmEnv);
}

function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export function identityFromProfile(profile: Profile): Identity {
  return {
    firstName: clean(profile.firstName),
    lastName: clean(profile.lastName),
    email: clean(profile.email),
    phone: clean(profile.phone),
    postalAddress: clean(profile.postalAddress),
    links: profile.links.map((l) => l.trim()).filter(Boolean),
    revealFirstName: profile.revealFirstName,
  };
}
