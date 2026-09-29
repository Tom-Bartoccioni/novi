import { describe, expect, it } from 'vitest';
import { distanceKm } from '../src/geo';

const NICE = { latitude: 43.7102, longitude: 7.262 };
const SOPHIA = { latitude: 43.6161, longitude: 7.0553 };
const CANNES = { latitude: 43.5528, longitude: 7.0174 };

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm(NICE, NICE)).toBe(0);
  });
  it('Nice to Sophia Antipolis is about 20 km', () => {
    expect(distanceKm(NICE, SOPHIA)).toBeGreaterThan(18);
    expect(distanceKm(NICE, SOPHIA)).toBeLessThan(21);
  });
  it('Nice to Cannes is about 26 km', () => {
    expect(distanceKm(NICE, CANNES)).toBeGreaterThan(25);
    expect(distanceKm(NICE, CANNES)).toBeLessThan(28);
  });
});
