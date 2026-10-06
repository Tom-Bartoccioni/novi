import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();

class APIError extends Error {
  status: number | undefined;
  constructor(status?: number, message = 'api') {
    super(message);
    this.status = status;
  }
}
class AuthenticationError extends APIError {}
class PermissionDeniedError extends APIError {}
class RateLimitError extends APIError {}
class APIConnectionError extends APIError {}
// Comme dans le SDK : le délai dépassé est une erreur de connexion particulière.
class APIConnectionTimeoutError extends APIConnectionError {}

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = { create };
    static APIError = APIError;
    static AuthenticationError = AuthenticationError;
    static PermissionDeniedError = PermissionDeniedError;
    static RateLimitError = RateLimitError;
    static APIConnectionError = APIConnectionError;
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
  }
  return { default: Anthropic };
});

import { createAnthropicGenerator } from '../src/llm/anthropic';

const input = { system: 'S', prompt: 'P', maxTokens: 100 };

describe('createAnthropicGenerator', () => {
  beforeEach(() => create.mockReset());

  it('sends system and user message and joins text blocks', async () => {
    create.mockResolvedValue({
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: 'Bon' },
        { type: 'text', text: 'jour' },
      ],
    });
    const gen = createAnthropicGenerator({ apiKey: 'k', model: 'claude-opus-5-5' });
    expect(gen.label).toBe('anthropic/claude-opus-5-5');
    const r = await gen.generate(input);
    expect(r).toEqual({ text: 'Bonjour', model: 'claude-opus-5-5' });
    expect(create).toHaveBeenCalledWith(
      {
        model: 'claude-opus-5-5',
        max_tokens: 100,
        system: 'S',
        messages: [{ role: 'user', content: 'P' }],
      },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });
  it('maps a refusal stop reason', async () => {
    create.mockResolvedValue({ model: 'm', stop_reason: 'refusal', content: [] });
    const gen = createAnthropicGenerator({ apiKey: 'k', model: 'm' });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'refused' });
  });
  it('maps SDK errors to LlmError codes', async () => {
    const gen = createAnthropicGenerator({ apiKey: 'k', model: 'm' });
    create.mockRejectedValueOnce(new AuthenticationError(401));
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'unauthorized' });
    create.mockRejectedValueOnce(new RateLimitError(429));
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'rate_limited' });
    create.mockRejectedValueOnce(new APIConnectionTimeoutError());
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'timeout' });
    create.mockRejectedValueOnce(new APIError(500));
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'http', status: 500 });
  });
  it('reports an unreachable provider explicitly', async () => {
    const gen = createAnthropicGenerator({ apiKey: 'k', model: 'm' });
    create.mockRejectedValueOnce(new APIConnectionError(undefined, 'Connection error.'));
    await expect(gen.generate(input)).rejects.toMatchObject({
      code: 'http',
      message: 'Fournisseur LLM injoignable : Connection error.',
    });
  });
  it('rejects an API key with invalid characters without echoing it', () => {
    for (const apiKey of ['sk-ant abc', 'sk-ant-abc\n', 'sk-ant-é']) {
      expect(() => createAnthropicGenerator({ apiKey, model: 'm' })).toThrow(
        expect.objectContaining({
          code: 'llm_misconfigured',
          message: expect.not.stringContaining('sk-ant'),
        }),
      );
    }
  });
  it('reports a caller cancellation as such', async () => {
    const gen = createAnthropicGenerator({ apiKey: 'k', model: 'm' });
    const controller = new AbortController();
    controller.abort();
    create.mockRejectedValueOnce(new APIError(undefined, 'Request was aborted.'));
    await expect(gen.generate(input, controller.signal)).rejects.toMatchObject({
      code: 'timeout',
      message: 'Génération annulée',
    });
  });
  it('rejects an empty answer', async () => {
    create.mockResolvedValue({ model: 'm', stop_reason: 'end_turn', content: [] });
    const gen = createAnthropicGenerator({ apiKey: 'k', model: 'm' });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'bad_response' });
  });
});
