import { describe, expect, it } from 'vitest';
import { parseGeocode } from '../src/sources/adresse';

describe('parseGeocode', () => {
  it('returns the best feature as a point with a label', () => {
    const payload = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [7.262, 43.7102] },
          properties: { label: 'Nice', score: 0.9, city: 'Nice', postcode: '06000' },
        },
      ],
    };
    expect(parseGeocode(payload)).toEqual({ label: 'Nice', latitude: 43.7102, longitude: 7.262 });
    expect(parseGeocode({ type: 'FeatureCollection', features: [] })).toBeNull();
  });
});
