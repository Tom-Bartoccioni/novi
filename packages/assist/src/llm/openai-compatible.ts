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
async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  // Le corps est abandonné sans être lu : il n'est jamais affiché.
  await response.body?.cancel().catch(() => {});
  if (response.status === 401 || response.status === 403) throw new LlmError('unauthorized');
  if (response.status === 429) {
    throw new LlmError('rate_limited', {
      retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
    });
  }
  throw new LlmError('http', { status: response.status });
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
        await ensureOk(response);
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
