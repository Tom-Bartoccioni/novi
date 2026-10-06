import { AssistError, LlmError } from '../errors';
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
    const retry = Number(response.headers.get('retry-after'));
    throw new LlmError('rate_limited', {
      retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : undefined,
    });
  }
  throw new LlmError('http', { status: response.status });
}

/** Retire la clé d'un message d'erreur, au cas où une bibliothèque réseau la recopierait. */
function redact(message: string, apiKey: string): string {
  return apiKey ? message.split(apiKey).join('…') : message;
}

/**
 * Convertit une erreur levée pendant l'appel ou la lecture du corps.
 * Une annulation par l'appelant est signalée avec le code `timeout` : un appelant qui réessaie
 * sur `timeout` doit d'abord vérifier son propre `signal.aborted`.
 */
function toLlmError(
  err: unknown,
  caller: AbortSignal | undefined,
  timeout: AbortSignal,
  timeoutMessage: string,
  apiKey: string,
): LlmError {
  if (err instanceof LlmError) return err;
  if (caller?.aborted) return new LlmError('timeout', { message: 'Génération annulée' });
  const isAbort = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
  if (timeout.aborted || isAbort) return new LlmError('timeout', { message: timeoutMessage });
  if (err instanceof SyntaxError) return new LlmError('bad_response');
  let detail = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? (err.cause as { code?: unknown } | undefined) : undefined;
  if (typeof cause?.code === 'string') detail += ` (${cause.code})`;
  return new LlmError('http', { message: `Fournisseur LLM injoignable : ${redact(detail, apiKey)}` });
}

export function createOpenAiCompatibleGenerator(opts: OpenAiCompatibleOptions): TextGenerator {
  // Un espace ou un saut de ligne ferait échouer l'en-tête, et le message d'erreur recopierait la clé.
  if (/[^\x21-\x7e]/.test(opts.apiKey)) {
    throw new AssistError(
      'llm_misconfigured',
      'LLM_API_KEY contient des caractères invalides (espace, saut de ligne ?)',
    );
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS;
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  const timeoutMessage = `Délai dépassé (${seconds} s) en attendant le fournisseur LLM`;

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
        throw toLlmError(err, signal, timeout, timeoutMessage, opts.apiKey);
      }
      const choice = json?.choices?.[0];
      if (choice?.finish_reason === 'content_filter') throw new LlmError('refused');
      const text = choice?.message?.content?.trim();
      if (!text) throw new LlmError('bad_response');
      return { text, model: json?.model ?? opts.model };
    },
  };
}
