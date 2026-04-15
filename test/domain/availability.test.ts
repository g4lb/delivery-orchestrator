import { fits } from '../../src/domain/availability';

describe('fits', () => {
  it('accepts when empty window has room', () => {
    expect(fits(100, 0, 1000)).toBe(true);
  });

  it('accepts partial fill that still leaves room', () => {
    expect(fits(100, 500, 1000)).toBe(true);
  });

  it('accepts exact fit', () => {
    expect(fits(500, 500, 1000)).toBe(true);
  });

  it('rejects one kg over', () => {
    expect(fits(501, 500, 1000)).toBe(false);
  });

  it('rejects when order alone exceeds capacity', () => {
    expect(fits(1500, 0, 1000)).toBe(false);
  });

  it('rejects when window is already at capacity', () => {
    expect(fits(1, 1000, 1000)).toBe(false);
  });
});
