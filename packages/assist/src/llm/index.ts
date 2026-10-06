import { AssistError } from '../errors';
import { ANTHROPIC_DEFAULT_MODEL, createAnthropicGenerator } from './anthropic';
import { createOpenAiCompatibleGenerator } from './openai-compatible';
import type { TextGenerator } from './types';

export type LlmEnv = Partial<Record<'LLM_PROVIDER' | 'LLM_BASE_URL' | 'LLM_API_KEY' | 'LLM_MODEL', string>>;

const PROVIDERS = ['openai-compatible', 'anthropic'] as const;

function required(env: LlmEnv, name: keyof LlmEnv): string {
  const value = env[name]?.trim();
  if (!value)
    throw new AssistError('llm_misconfigured', `Variable ${name} manquante dans .env (voir .env.example)`);
  return value;
}

/**
 * `null` quand aucun fournisseur n'est déclaré ;
 * lève `AssistError('llm_misconfigured')` si la configuration est incomplète.
 */
export function createGenerator(env: LlmEnv = process.env as LlmEnv): TextGenerator | null {
  const provider = env.LLM_PROVIDER?.trim().toLowerCase();
  if (!provider) return null;
  if (provider === 'openai-compatible') {
    return createOpenAiCompatibleGenerator({
      baseUrl: required(env, 'LLM_BASE_URL'),
      apiKey: required(env, 'LLM_API_KEY'),
      model: required(env, 'LLM_MODEL'),
    });
  }
  if (provider === 'anthropic') {
    return createAnthropicGenerator({
      apiKey: required(env, 'LLM_API_KEY'),
      model: env.LLM_MODEL?.trim() || ANTHROPIC_DEFAULT_MODEL,
      // Facultatif (passerelle ou proxy) ; transmis plutôt qu'ignoré sans le dire.
      baseUrl: env.LLM_BASE_URL?.trim() || undefined,
    });
  }
  throw new AssistError(
    'llm_misconfigured',
    `LLM_PROVIDER inconnu : « ${provider} » (valeurs possibles : ${PROVIDERS.join(', ')})`,
  );
}

export type GeneratorStatus = { configured: true; label: string } | { configured: false; problem?: string };

/** État affichable de la configuration ; seules les erreurs de configuration sont converties. */
export function describeGenerator(env: LlmEnv = process.env as LlmEnv): GeneratorStatus {
  try {
    const gen = createGenerator(env);
    return gen ? { configured: true, label: gen.label } : { configured: false };
  } catch (err) {
    if (err instanceof AssistError) return { configured: false, problem: err.message };
    throw err;
  }
}
