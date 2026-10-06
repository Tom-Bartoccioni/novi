import { LlmError } from '../errors';
import { type GenerateInput, type GenerateResult, LLM_TIMEOUT_MS, type TextGenerator } from './types';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';

export type AnthropicOptions = { apiKey: string; model: string; timeoutMs?: number };

export function createAnthropicGenerator(opts: AnthropicOptions): TextGenerator {
  const timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS;
  return {
    label: `anthropic/${opts.model}`,
    async generate(input: GenerateInput, signal?: AbortSignal): Promise<GenerateResult> {
      // Import dynamique : le SDK n'est chargé que si ce fournisseur est choisi.
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: opts.apiKey });
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
        // Seuls les blocs de texte forment la réponse ; les blocs de réflexion sont ignorés.
        const text = response.content
          .flatMap((b) => (b.type === 'text' ? [b.text] : []))
          .join('')
          .trim();
        if (!text) throw new LlmError('bad_response');
        return { text, model: response.model };
      } catch (err) {
        if (err instanceof LlmError) throw err;
        // Comme pour l'adaptateur compatible OpenAI : une annulation par l'appelant est un `timeout`.
        if (signal?.aborted) throw new LlmError('timeout', { message: 'Génération annulée' });
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
          throw new LlmError('unauthorized');
        if (err instanceof Anthropic.RateLimitError) throw new LlmError('rate_limited');
        if (err instanceof Anthropic.APIConnectionTimeoutError) throw new LlmError('timeout');
        if (err instanceof Anthropic.APIError) throw new LlmError('http', { status: err.status });
        throw err;
      }
    },
  };
}
