import type { DeliveryWindow, OrderPayload } from '../types';

export function windowMatchesOrder(window: DeliveryWindow, order: OrderPayload): boolean {
  return window.start_time >= order.min_time && window.start_time < order.max_time;
}
