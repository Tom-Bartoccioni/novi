import { describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleGenerator } from '../src/llm/openai-compatible';

type FetchImpl = typeof fetch;

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}): FetchImpl {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers })) as unknown as FetchImpl;
}

const opts = { baseUrl: 'https://llm.example/v1/', apiKey: 'k', model: 'm' };
const input = { system: 'S', prompt: 'P', maxTokens: 100 };

describe('createOpenAiCompatibleGenerator', () => {
  it('posts to /chat/completions and returns the first choice', async () => {
    const fetchImpl = fakeFetch(200, { choices: [{ message: { content: 'Bonjour' } }], model: 'm-001' });
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl });
    const r = await gen.generate(input);
    expect(r).toEqual({ text: 'Bonjour', model: 'm-001' });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
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
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl: fakeFetch(403, {}) });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'unauthorized' });
  });
  it('maps 429 to rate_limited with retry-after', async () => {
    const gen = createOpenAiCompatibleGenerator({
      ...opts,
      fetchImpl: fakeFetch(429, {}, { 'retry-after': '42' }),
    });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 42 });
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
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }) as unknown as FetchImpl;
    const gen = createOpenAiCompatibleGenerator({ ...opts, fetchImpl, timeoutMs: 10 });
    await expect(gen.generate(input)).rejects.toMatchObject({ code: 'timeout' });
  });
});
