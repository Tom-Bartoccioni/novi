import type Anthropic from '@anthropic-ai/sdk';
import { LlmError } from '../errors';
import {
  assertValidApiKey,
  cancelledError,
  parseRetryAfter,
  timeoutError,
  truncatedError,
  unreachableError,
} from './shared';
import { type GenerateInput, type GenerateResult, LLM_TIMEOUT_MS, type TextGenerator } from './types';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';

export type AnthropicOptions = { apiKey: string; model: string; baseUrl?: string; timeoutMs?: number };

type Sdk = { Anthropic: typeof Anthropic; client: Anthropic };

/** En-tête `retry-after` d'une erreur du SDK, lu prudemment : `headers` est un `Headers` quand il existe. */
function retryAfterOf(err: unknown): number | undefined {
  const headers = (err as { headers?: { get?: unknown } }).headers;
  if (typeof headers?.get !== 'function') return undefined;
  return parseRetryAfter((headers as Headers).get('retry-after'));
}

export function createAnthropicGenerator(opts: AnthropicOptions): TextGenerator {
  assertValidApiKey(opts.apiKey);
  const timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS;
  let sdk: Promise<Sdk> | undefined;

  // Import dynamique et client créé une seule fois : le SDK n'est chargé que si ce fournisseur est utilisé.
  function loadSdk(): Promise<Sdk> {
    sdk ??= import('@anthropic-ai/sdk').then(
      ({ default: Anthropic }) => ({
        Anthropic,
        // Sans nouvelle tentative du SDK : le délai couvre tout l'appel et un 429 remonte tout de suite.
        client: new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseUrl, maxRetries: 0 }),
      }),
      (err: unknown) => {
        sdk = undefined;
        throw err;
      },
    );
    return sdk;
  }

  return {
    label: `anthropic/${opts.model}`,
    async generate(input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult> {
      const { Anthropic, client } = await loadSdk();
      try {
        const response = await client.messages.create(
          {
            model: opts.model,
            max_tokens: input.maxTokens,
            system: input.system,
            messages: [{ role: 'user', content: input.prompt }],
          },
          { timeout: timeoutMs, signal },
        );
        if (response.stop_reason === 'refusal') throw new LlmError('refused');
        if (response.stop_reason === 'max_tokens') throw truncatedError();
        // Seuls les blocs de texte forment la réponse ; les blocs de réflexion sont ignorés.
        const text = response.content
          .flatMap((b) => (b.type === 'text' ? [b.text] : []))
          .join('')
          .trim();
        if (!text) throw new LlmError('bad_response');
        return { text, model: response.model };
      } catch (err) {
        if (err instanceof LlmError) throw err;
        if (signal?.aborted) throw cancelledError();
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
          throw new LlmError('unauthorized');
        if (err instanceof Anthropic.RateLimitError)
          throw new LlmError('rate_limited', { retryAfterSeconds: retryAfterOf(err) });
        if (err instanceof Anthropic.APIConnectionTimeoutError) throw timeoutError(timeoutMs);
        // Testé après APIConnectionTimeoutError, qui en hérite dans le SDK.
        if (err instanceof Anthropic.APIConnectionError) throw unreachableError(err, opts.apiKey);
        if (err instanceof Anthropic.APIError) throw new LlmError('http', { status: err.status });
        throw err;
      }
    },
  };
}
