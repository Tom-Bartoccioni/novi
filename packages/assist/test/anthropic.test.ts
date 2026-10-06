import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const construct = vi.fn();

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
    constructor(options: unknown) {
      construct(options);
    }
  }
  return { default: Anthropic };
});

import { createAnthropicGenerator } from '../src/llm/anthropic';
import { LLM_TIMEOUT_MS } from '../src/llm/types';

const input = { system: 'S', prompt: 'P', maxTokens: 100 };
const ok = { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: 'OK' }] };

describe('createAnthropicGenerator', () => {
  beforeEach(() => {
    create.mockReset();
    construct.mockReset();
  });

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
      { timeout: LLM_TIMEOUT_MS, signal: undefined },
    );
  });
  it('disables SDK retries and creates the client once', async () => {
    create.mockResolvedValue(ok);
    const gen = createAnthropicGenerator({ apiKey: 'k', model: 'm' });
    expect(construct).not.toHaveBeenCalled();
    await gen.generate(input);
    await gen.generate(input);
    expect(construct).toHaveBeenCalledTimes(1);
    expect(construct).toHaveBeenCalledWith({ apiKey: 'k', baseURL: undefined, maxRetries: 0 });
  });
  it('passes a custom base URL to the SDK', async () => {
    create.mockResolvedValue(ok);
    const gen = createAnthropicGenerator({ apiKey: 'k', model: 'm', baseUrl: 'https://proxy.example' });
    await gen.generate(input);
    expect(construct).toHaveBeenCalledWith({ apiKey: 'k', baseURL: 'https://proxy.example', maxRetries: 0 });
  });
  it('forwards the caller signal', async () => {
    create.mockResolvedValue(ok);
    const controller = new AbortController();
    await createAnthropicGenerator({ apiKey: 'k', model: 'm' }).generate(input, controller.signal);
    expect(create).toHaveBeenCalledWith(expect.anything(), {
      timeout: LLM_TIMEOUT_MS,
      signal: controller.signal,
    });
  });
  it('uses a custom timeout for the request and the message', async () => {
    const gen = createAnthropicGenerator({ apiKey: 'k', model: 'm', timeoutMs: 45_000 });
    create.mockRejectedValueOnce(new APIConnectionTimeoutError());
    await expect(gen.generate(input)).rejects.toMatchObject({
      code: 'timeout',
      message: 'Délai dépassé (45 s) en attendant le fournisseur LLM',
    });
    expect(create).toHaveBeenCalledWith(expect.anything(), { timeout: 45_000, signal: undefined });
  });
  it('ignores non-text blocks', async () => {
    create.mockResolvedValue({
      model: 'm',
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'réflexion', signature: 'x' },
        { type: 'text', text: 'Réponse' },
      ],
    });
    const r = await createAnthropicGenerator({ apiKey: 'k', model: 'm' }).generate(input);
    expect(r.text).toBe('Réponse');
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
    create.mockRejectedValueOnce(new PermissionDeniedError(403));
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'unauthorized' });
    create.mockRejectedValueOnce(new RateLimitError(429));
    await expect(gen.generate(input)).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterSeconds: undefined,
    });
    create.mockRejectedValueOnce(new APIConnectionTimeoutError());
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'timeout', message: /Délai dépassé/ });
    create.mockRejectedValueOnce(new APIError(500));
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'http', status: 500 });
  });
  it('reads retry-after on a rate limit', async () => {
    const gen = createAnthropicGenerator({ apiKey: 'k', model: 'm' });
    const err = Object.assign(new RateLimitError(429), { headers: new Headers({ 'retry-after': '30' }) });
    create.mockRejectedValueOnce(err);
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 30 });
  });
  it('reports an unreachable provider explicitly', async () => {
    const gen = createAnthropicGenerator({ apiKey: 'k', model: 'm' });
    create.mockRejectedValueOnce(new APIConnectionError(undefined, 'Connection error.'));
    await expect(gen.generate(input)).rejects.toMatchObject({
      code: 'http',
      message: 'Fournisseur LLM injoignable : Connection error.',
    });
    // Le SDK enveloppe l'erreur de fetch, qui porte elle-même le code système.
    const wrapped = new APIConnectionError(undefined, 'Connection error.');
    wrapped.cause = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    create.mockRejectedValueOnce(wrapped);
    await expect(gen.generate(input)).rejects.toMatchObject({
      message: 'Fournisseur LLM injoignable : Connection error. (ECONNREFUSED)',
    });
  });
  it('rethrows errors that do not come from the SDK', async () => {
    const boom = new TypeError('boom');
    create.mockRejectedValueOnce(boom);
    await expect(createAnthropicGenerator({ apiKey: 'k', model: 'm' }).generate(input)).rejects.toBe(boom);
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
