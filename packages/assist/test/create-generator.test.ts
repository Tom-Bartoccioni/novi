import { describe, expect, it } from 'vitest';
import { createGenerator, describeGenerator } from '../src/llm';

describe('createGenerator', () => {
  it('returns null when no provider is configured', () => {
    expect(createGenerator({})).toBeNull();
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
  });
  it('throws a misconfiguration error naming the missing variable', () => {
    expect(() => createGenerator({ LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'k' })).toThrow(
      /LLM_BASE_URL/,
    );
    expect(describeGenerator({ LLM_PROVIDER: 'openai-compatible' })).toMatchObject({
      configured: false,
      problem: expect.stringContaining('LLM_'),
    });
  });
  it('rejects an unknown provider', () => {
    expect(() => createGenerator({ LLM_PROVIDER: 'bogus' })).toThrow(/LLM_PROVIDER/);
  });
});
