import { describe, expect, it } from 'vitest';
import { AssistError, LlmError } from '../src/errors';

describe('AssistError', () => {
  it('carries a code and a French message', () => {
    const err = new AssistError('cv_no_text');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('cv_no_text');
    expect(err.message).toMatch(/aucun texte/i);
  });
  it('accepts a custom message', () => {
    expect(new AssistError('llm_misconfigured', 'Variable LLM_API_KEY manquante').message).toBe(
      'Variable LLM_API_KEY manquante',
    );
  });
});

describe('LlmError', () => {
  it('exposes retryAfterSeconds for rate limits', () => {
    const err = new LlmError('rate_limited', { retryAfterSeconds: 30 });
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterSeconds).toBe(30);
    expect(err.message).toContain('30 secondes');
  });
  it('has a default message per code', () => {
    expect(new LlmError('unauthorized').message).toMatch(/clé/i);
    expect(new LlmError('timeout').message).toMatch(/délai/i);
    expect(new LlmError('refused').message).toMatch(/refusé/i);
  });
});
