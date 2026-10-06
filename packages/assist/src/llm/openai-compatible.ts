import { LlmError } from '../errors';
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

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

export function createOpenAiCompatibleGenerator(opts: OpenAiCompatibleOptions): TextGenerator {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS;
  const timeoutMessage = `Délai dépassé (${Math.round(timeoutMs / 1000)} s) en attendant le fournisseur LLM`;

  // Lit et jette le corps d'une réponse en erreur pour libérer la connexion, sans jamais l'afficher.
  async function discard(response: Response): Promise<void> {
    await response.text().catch(() => '');
  }

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
        if (response.status === 401 || response.status === 403) {
          await discard(response);
          throw new LlmError('unauthorized');
        }
        if (response.status === 429) {
          await discard(response);
          const retry = Number(response.headers.get('retry-after'));
          throw new LlmError('rate_limited', {
            retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : undefined,
          });
        }
        if (!response.ok) {
          await discard(response);
          throw new LlmError('http', { status: response.status });
        }
        // Le corps est lu sous le même signal : une coupure pendant la lecture reste un délai dépassé.
        json = (await response.json()) as ChatCompletion | null;
      } catch (err) {
        if (err instanceof LlmError) throw err;
        // L'annulation par l'appelant prime sur tout le reste, quelle que soit la raison transmise.
        if (signal?.aborted) throw new LlmError('timeout', { message: 'Génération annulée' });
        if (timeout.aborted || isAbort(err)) throw new LlmError('timeout', { message: timeoutMessage });
        if (err instanceof SyntaxError) throw new LlmError('bad_response');
        throw new LlmError('http', { message: `Fournisseur LLM injoignable : ${(err as Error).message}` });
      }
      const choice = json?.choices?.[0];
      if (choice?.finish_reason === 'content_filter') throw new LlmError('refused');
      const text = choice?.message?.content?.trim();
      if (!text) throw new LlmError('bad_response');
      return { text, model: json?.model ?? opts.model };
    },
  };
}
