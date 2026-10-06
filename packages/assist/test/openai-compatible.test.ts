import { describe, expect, it, vi } from 'vitest';
import { AssistError, LlmError } from '../src/errors';
import { createOpenAiCompatibleGenerator } from '../src/llm/openai-compatible';

type FetchImpl = typeof fetch;

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn<FetchImpl>(async () => new Response(JSON.stringify(body), { status, headers }));
}

/** Un `fetch` qui ne répond jamais et rejette quand son signal est déclenché. */
function hangingFetch() {
  return vi.fn<FetchImpl>(async (_url, init) => {
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  });
}

/** Un `fetch` qui répond 200 mais dont le corps reste incomplet jusqu'au déclenchement du signal. */
function stalledBodyFetch() {
  return vi.fn<FetchImpl>(async (_url, init) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"choices":'));
        init?.signal?.addEventListener('abort', () =>
          controller.error(new DOMException('aborted', 'AbortError')),
        );
      },
    });
    return new Response(body, { status: 200 });
  });
}

const opts = { baseUrl: 'https://llm.example/v1/', apiKey: 'k', model: 'm' };
const input = { system: 'S', prompt: 'P', maxTokens: 100 };

describe('createOpenAiCompatibleGenerator', () => {
  it('posts to /chat/completions and returns the first choice', async () => {
    const fetchImpl = fakeFetch(200, { choices: [{ message: { content: 'Bonjour' } }], model: 'm-001' });
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl });
    const r = await gen.generate(input);
    expect(r).toEqual({ text: 'Bonjour', model: 'm-001' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect(init.headers).toMatchObject({ authorization: 'Bearer k', 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'm',
      messages: [
        { role: 'system', content: 'S' },
        { role: 'user', content: 'P' },
      ],
      max_tokens: 100,
      temperature: 0.7,
    });
    expect(gen.label).toBe('openai-compatible/m');
  });
  it('maps 401 and 403 to unauthorized', async () => {
    for (const status of [401, 403]) {
      const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl: fakeFetch(status, {}) });
      await expect(gen.generate(input)).rejects.toMatchObject({ code: 'unauthorized' });
    }
  });
  it('maps 429 to rate_limited with retry-after', async () => {
    const gen = createOpenAiCompatibleGenerator({
      ...opts,
      fetchImpl: fakeFetch(429, {}, { 'retry-after': '42' }),
    });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 42 });
  });
  it('ignores a retry-after that is not a number of seconds', async () => {
    for (const retryAfter of ['Wed, 21 Oct 2026 07:28:00 GMT', 'bientôt', '0']) {
      const gen = createOpenAiCompatibleGenerator({
        ...opts,
        fetchImpl: fakeFetch(429, {}, { 'retry-after': retryAfter }),
      });
      await expect(gen.generate(input)).rejects.toMatchObject({
        code: 'rate_limited',
        retryAfterSeconds: undefined,
      });
    }
  });
  it('maps other statuses to http', async () => {
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl: fakeFetch(503, {}) });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'http', status: 503 });
  });
  it('rejects a response without text', async () => {
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl: fakeFetch(200, { choices: [] }) });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'bad_response' });
  });
  it('maps an abort to timeout', async () => {
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl: hangingFetch(), timeoutMs: 10 });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'timeout', message: /Délai dépassé/ });
  });
  it('states the configured delay in the timeout message', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => {
      throw new DOMException('délai', 'TimeoutError');
    });
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl, timeoutMs: 45_000 });
    await expect(gen.generate(input)).rejects.toMatchObject({
      code: 'timeout',
      message: 'Délai dépassé (45 s) en attendant le fournisseur LLM',
    });
  });
  it('tells a cancellation by the caller apart from the timeout', async () => {
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl: hangingFetch() });
    const controller = new AbortController();
    const pending = gen.generate(input, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'timeout', message: 'Génération annulée' });
  });
  it('maps an abort while reading the body to timeout', async () => {
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl: stalledBodyFetch(), timeoutMs: 10 });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'timeout', message: /Délai dépassé/ });
  });
  it('maps a cancellation by the caller while reading the body to a cancellation', async () => {
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl: stalledBodyFetch() });
    const controller = new AbortController();
    const pending = gen.generate(input, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'timeout', message: 'Génération annulée' });
  });
  it('maps an unparsable body to bad_response', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => new Response('pas du JSON', { status: 200 }));
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'bad_response' });
  });
  it('maps a content filter to refused, with or without content', async () => {
    for (const content of ['Texte partiel', null]) {
      const body = { choices: [{ message: { content }, finish_reason: 'content_filter' }] };
      const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl: fakeFetch(200, body) });
      await expect(gen.generate(input)).rejects.toMatchObject({ code: 'refused' });
    }
  });
  it('maps an unreachable provider to http, with the network error code', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    });
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl });
    await expect(gen.generate(input)).rejects.toMatchObject({
      code: 'http',
      message: 'Fournisseur LLM injoignable : fetch failed (ECONNREFUSED)',
    });
  });
  it('never repeats the API key in a network error message', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => {
      throw new TypeError('Headers.append: "Bearer sk-secret-123" is an invalid header value');
    });
    const gen = createOpenAiCompatibleGenerator({ ...opts, apiKey: 'sk-secret-123', fetchImpl });
    const err = await gen.generate(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).code).toBe('http');
    expect((err as LlmError).message).not.toContain('sk-secret-123');
  });
  it('rejects an API key with whitespace or control characters', () => {
    for (const apiKey of ['sk-abc\n', 'sk abc', 'sk-abc\t']) {
      expect(() => createOpenAiCompatibleGenerator({ ...opts, apiKey })).toThrow(AssistError);
      try {
        createOpenAiCompatibleGenerator({ ...opts, apiKey });
      } catch (err) {
        expect(err).toMatchObject({ code: 'llm_misconfigured' });
        expect((err as Error).message).not.toContain('sk-abc');
      }
    }
  });
  it('drains the body of an error response to release the connection', async () => {
    for (const status of [401, 429, 500]) {
      const response = new Response('détail du fournisseur', { status });
      const fetchImpl = vi.fn<FetchImpl>(async () => response);
      const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl });
      await expect(gen.generate(input)).rejects.toBeInstanceOf(LlmError);
      expect(response.bodyUsed).toBe(true);
    }
  });
});
