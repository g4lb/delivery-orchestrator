import { haversineKm } from '../../src/domain/geo';

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm({ lat: 32.08, lng: 34.78 }, { lat: 32.08, lng: 34.78 })).toBeCloseTo(0, 5);
  });

  it('computes Tel Aviv -> Jerusalem within 1% of 54 km', () => {
    const tlv = { lat: 32.0853, lng: 34.7818 };
    const jlm = { lat: 31.7683, lng: 35.2137 };
    const d = haversineKm(tlv, jlm);
    expect(d).toBeGreaterThan(53);
    expect(d).toBeLessThan(55);
  });

  it('handles antipodal points', () => {
    const d = haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
    // Earth half-circumference ≈ 20015 km
    expect(d).toBeGreaterThan(20000);
    expect(d).toBeLessThan(20030);
  });

  it('handles negative longitudes symmetrically', () => {
    const d1 = haversineKm({ lat: 0, lng: 10 }, { lat: 0, lng: 20 });
    const d2 = haversineKm({ lat: 0, lng: -10 }, { lat: 0, lng: -20 });
    expect(d1).toBeCloseTo(d2, 5);
  });
});
