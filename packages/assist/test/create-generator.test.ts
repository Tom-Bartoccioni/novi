import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/llm/anthropic', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/llm/anthropic')>();
  return { ...original, createAnthropicGenerator: vi.fn(original.createAnthropicGenerator) };
});

import { createGenerator, describeGenerator } from '../src/llm';
import { createAnthropicGenerator } from '../src/llm/anthropic';

describe('createGenerator', () => {
  // Accolades indispensables : une fonction renvoyée par `beforeEach` serait appelée comme nettoyage.
  beforeEach(() => {
    vi.mocked(createAnthropicGenerator).mockClear();
  });

  it('returns null when no provider is configured', () => {
    expect(createGenerator({})).toBeNull();
    expect(createGenerator({ LLM_PROVIDER: '   ' })).toBeNull();
    expect(describeGenerator({})).toEqual({ configured: false });
  });
  it('builds an openai-compatible generator', () => {
    const env = {
      LLM_PROVIDER: 'openai-compatible',
      LLM_BASE_URL: 'https://llm.example/v1',
      LLM_API_KEY: 'k',
      LLM_MODEL: 'gemini-2.5-flash',
    };
    expect(createGenerator(env)?.label).toBe('openai-compatible/gemini-2.5-flash');
    expect(describeGenerator(env)).toEqual({ configured: true, label: 'openai-compatible/gemini-2.5-flash' });
  });
  it('builds an anthropic generator with the default model', () => {
    const env = { LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k' };
    expect(createGenerator(env)?.label).toBe('anthropic/claude-opus-5-5');
    expect(createAnthropicGenerator).toHaveBeenCalledWith({
      apiKey: 'k',
      model: 'claude-opus-5-5',
      baseUrl: undefined,
    });
  });
  it('lets LLM_MODEL and LLM_BASE_URL override the anthropic defaults', () => {
    const env = {
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: 'k',
      LLM_MODEL: ' claude-sonnet-5 ',
      LLM_BASE_URL: ' https://proxy.example ',
    };
    expect(createGenerator(env)?.label).toBe('anthropic/claude-sonnet-5');
    expect(createAnthropicGenerator).toHaveBeenCalledWith({
      apiKey: 'k',
      model: 'claude-sonnet-5',
      baseUrl: 'https://proxy.example',
    });
  });
  it('trims and lowercases the provider and trims the key', () => {
    const env = { LLM_PROVIDER: '  Anthropic \n', LLM_API_KEY: '  k\r\n' };
    expect(createGenerator(env)?.label).toBe('anthropic/claude-opus-5-5');
    expect(createAnthropicGenerator).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'k' }));
    const openai = {
      LLM_PROVIDER: ' OpenAI-Compatible ',
      LLM_BASE_URL: 'https://llm.example/v1',
      LLM_API_KEY: ' k ',
      LLM_MODEL: 'm',
    };
    expect(createGenerator(openai)?.label).toBe('openai-compatible/m');
  });
  it('throws a misconfiguration error naming the missing variable', () => {
    expect(() => createGenerator({ LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'k' })).toThrow(
      /LLM_BASE_URL/,
    );
    expect(() => createGenerator({ LLM_PROVIDER: 'anthropic' })).toThrow(/LLM_API_KEY/);
    expect(() => createGenerator({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: '  ' })).toThrow(/LLM_API_KEY/);
    expect(describeGenerator({ LLM_PROVIDER: 'openai-compatible' })).toMatchObject({
      configured: false,
      problem: expect.stringContaining('LLM_'),
    });
  });
  it('rejects an unknown provider', () => {
    expect(() => createGenerator({ LLM_PROVIDER: 'bogus' })).toThrow(/LLM_PROVIDER/);
    expect(describeGenerator({ LLM_PROVIDER: 'bogus', LLM_API_KEY: 'sk-secret' })).toEqual({
      configured: false,
      problem: expect.stringContaining('LLM_PROVIDER'),
    });
  });
  it('never puts the key in the reported problem', () => {
    for (const env of [
      { LLM_PROVIDER: 'bogus', LLM_API_KEY: 'sk-secret' },
      { LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'sk-secret with space' },
      {
        LLM_PROVIDER: 'openai-compatible',
        LLM_BASE_URL: 'https://llm.example/v1',
        LLM_API_KEY: 'sk-secret\tvalue',
        LLM_MODEL: 'm',
      },
    ]) {
      const status = describeGenerator(env);
      expect(status.configured).toBe(false);
      expect(JSON.stringify(status)).not.toContain('sk-secret');
    }
  });
  it('lets describeGenerator rethrow unexpected errors', () => {
    const env = {};
    Object.defineProperty(env, 'LLM_PROVIDER', {
      get() {
        throw new TypeError('boom');
      },
    });
    expect(() => describeGenerator(env)).toThrow(TypeError);
  });
});
