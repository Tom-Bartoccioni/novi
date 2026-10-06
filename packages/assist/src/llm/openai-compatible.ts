import { LlmError } from '../errors';
import { type GenerateInput, type GenerateResult, LLM_TIMEOUT_MS, type TextGenerator } from './types';

export type OpenAiCompatibleOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type ChatCompletion = { model?: string; choices?: { message?: { content?: string | null } }[] };

function combinedSignal(timeoutMs: number, outer?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return outer ? AbortSignal.any([outer, timeout]) : timeout;
}

export function createOpenAiCompatibleGenerator(opts: OpenAiCompatibleOptions): TextGenerator {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS;
  return {
    label: `openai-compatible/${opts.model}`,
    async generate(input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult> {
      let response: Response;
      try {
        response = await fetchImpl(url, {
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
          signal: combinedSignal(timeoutMs, signal),
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw new LlmError('timeout');
        if (err instanceof Error && err.name === 'TimeoutError') throw new LlmError('timeout');
        throw new LlmError('http', { message: `Fournisseur LLM injoignable : ${(err as Error).message}` });
      }
      if (response.status === 401 || response.status === 403) throw new LlmError('unauthorized');
      if (response.status === 429) {
        const retry = Number(response.headers.get('retry-after'));
        throw new LlmError('rate_limited', {
          retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : undefined,
        });
      }
      if (!response.ok) throw new LlmError('http', { status: response.status });
      let json: ChatCompletion;
      try {
        json = (await response.json()) as ChatCompletion;
      } catch {
        throw new LlmError('bad_response');
      }
      const text = json.choices?.[0]?.message?.content?.trim();
      if (!text) throw new LlmError('bad_response');
      return { text, model: json.model ?? opts.model };
    },
  };
}
