import type { Team, DeliveryWindow, Order, OrderPayload } from '../../src/types';

export function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-default',
    name: 'Default Team',
    lng: 34.78,
    lat: 32.08,
    ...overrides,
  };
}

export function makeWindow(overrides: Partial<DeliveryWindow> = {}): DeliveryWindow {
  return {
    id: 'win-default',
    team_id: 'team-default',
    start_time: '2026-04-15 10:00:00',
    end_time: '2026-04-15 11:00:00',
    ...overrides,
  };
}

export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ord-default',
    window_id: 'win-default',
    lng: 34.78,
    lat: 32.08,
    weight: 100,
    created_at: '2026-04-15 09:00:00',
    ...overrides,
  };
}

export function makeOrderPayload(overrides: Partial<OrderPayload> = {}): OrderPayload {
  return {
    lng: 34.78,
    lat: 32.08,
    min_time: '2026-04-15 09:00:00',
    max_time: '2026-04-15 13:00:00',
    weight: 100,
    ...overrides,
  };
}
