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

export type OpenAiCompatibleOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type ChatCompletion = {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
};

/** Lève une `LlmError` pour toute réponse en erreur, après avoir vidé le corps pour libérer la connexion. */
const PROVIDER_MESSAGE_MAX = 200;

/**
 * Extrait le message d'erreur du fournisseur (format OpenAI `{ error: { message } }`, ou tableau Gemini),
 * tronqué et sans la clé : il explique au lecteur pourquoi le modèle est refusé (modèle retiré, forte demande…).
 */
async function providerMessage(response: Response, apiKey: string): Promise<string | undefined> {
  try {
    const raw = (await response.json()) as unknown;
    const body = Array.isArray(raw) ? raw[0] : raw;
    const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
    if (typeof message !== 'string' || !message.trim()) return undefined;
    const clean = apiKey ? message.split(apiKey).join('…') : message;
    return clean.length > PROVIDER_MESSAGE_MAX ? `${clean.slice(0, PROVIDER_MESSAGE_MAX)}…` : clean;
  } catch {
    return undefined;
  }
}

async function ensureOk(response: Response, apiKey: string): Promise<void> {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => {});
    throw new LlmError('unauthorized');
  }
  if (response.status === 429) {
    await response.body?.cancel().catch(() => {});
    throw new LlmError('rate_limited', {
      retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
    });
  }
  const detail = await providerMessage(response, apiKey);
  throw new LlmError('http', {
    status: response.status,
    message: detail ? `Erreur HTTP ${response.status} du fournisseur LLM : ${detail}` : undefined,
  });
}

/** Convertit une erreur levée pendant l'appel ou la lecture du corps. */
function toLlmError(
  err: unknown,
  caller: AbortSignal | undefined,
  timeout: AbortSignal,
  timeoutMs: number,
  apiKey: string,
): LlmError {
  if (err instanceof LlmError) return err;
  if (caller?.aborted) return cancelledError();
  const isAbort = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
  if (timeout.aborted || isAbort) return timeoutError(timeoutMs);
  if (err instanceof SyntaxError) return new LlmError('bad_response');
  return unreachableError(err, apiKey);
}

export function createOpenAiCompatibleGenerator(opts: OpenAiCompatibleOptions): TextGenerator {
  assertValidApiKey(opts.apiKey);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS;

  return {
    label: `openai-compatible/${opts.model}`,
    async generate(input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult> {
      const timeout = AbortSignal.timeout(timeoutMs);
      let json: ChatCompletion | null;
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: opts.model,
            messages: [
              { role: 'system', content: input.system },
              { role: 'user', content: input.prompt },
            ],
            max_tokens: input.maxTokens,
            temperature: 0.7,
          }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        await ensureOk(response, opts.apiKey);
        // Le corps est lu sous le même signal : une coupure pendant la lecture reste un délai dépassé.
        json = (await response.json()) as ChatCompletion | null;
      } catch (err) {
        throw toLlmError(err, signal, timeout, timeoutMs, opts.apiKey);
      }
      const choice = json?.choices?.[0];
      if (choice?.finish_reason === 'content_filter') throw new LlmError('refused');
      if (choice?.finish_reason === 'length') throw truncatedError();
      const text = choice?.message?.content?.trim();
      if (!text) throw new LlmError('bad_response');
      return { text, model: json?.model ?? opts.model };
    },
  };
}
