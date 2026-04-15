import { windowMatchesOrder } from '../../src/domain/time';
import type { DeliveryWindow, OrderPayload } from '../../src/types';

const order: OrderPayload = {
  lng: 0, lat: 0, weight: 100,
  min_time: '2026-04-15 09:00:00',
  max_time: '2026-04-15 12:00:00',
};

const makeWindow = (start: string, end: string): DeliveryWindow => ({
  id: 'w', team_id: 't', start_time: start, end_time: end,
});

describe('windowMatchesOrder', () => {
  it('matches when window starts exactly at min_time', () => {
    expect(windowMatchesOrder(makeWindow('2026-04-15 09:00:00', '2026-04-15 10:00:00'), order)).toBe(true);
  });

  it('matches when window starts strictly inside the range', () => {
    expect(windowMatchesOrder(makeWindow('2026-04-15 10:00:00', '2026-04-15 11:00:00'), order)).toBe(true);
  });

  it('matches when window starts inside but ends after max_time (half-open semantics)', () => {
    expect(windowMatchesOrder(makeWindow('2026-04-15 11:30:00', '2026-04-15 12:30:00'), order)).toBe(true);
  });

  it('rejects when window starts exactly at max_time (half-open on the right)', () => {
    expect(windowMatchesOrder(makeWindow('2026-04-15 12:00:00', '2026-04-15 13:00:00'), order)).toBe(false);
  });

  it('rejects when window starts before min_time', () => {
    expect(windowMatchesOrder(makeWindow('2026-04-15 08:30:00', '2026-04-15 09:30:00'), order)).toBe(false);
  });

  it('rejects when window starts after max_time', () => {
    expect(windowMatchesOrder(makeWindow('2026-04-15 13:00:00', '2026-04-15 14:00:00'), order)).toBe(false);
  });
});
