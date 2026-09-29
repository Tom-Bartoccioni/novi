import { describe, expect, it } from 'vitest';
import { trigramSimilarity } from '../src/similarity';

describe('trigramSimilarity', () => {
  it('is 1 for identical strings and 0 for disjoint ones', () => {
    expect(trigramSimilarity('cliken web', 'cliken web')).toBe(1);
    expect(trigramSimilarity('abc', 'xyz')).toBe(0);
  });
  it('is high for a one-letter typo', () => {
    expect(trigramSimilarity('cliken web', 'clicken web')).toBeGreaterThan(0.6);
  });
  it('is low for different names', () => {
    expect(trigramSimilarity('cliken web', 'nice tech studio')).toBeLessThan(0.2);
  });
  it('handles empty strings', () => {
    expect(trigramSimilarity('', 'abc')).toBe(0);
  });
});
