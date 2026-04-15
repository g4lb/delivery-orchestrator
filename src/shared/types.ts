export interface Team {
  id: string;
  name: string;
  lng: number;
  lat: number;
}

export interface DeliveryWindow {
  id: string;
  team_id: string;
  start_time: string;
  end_time: string;
}

export interface OrderPayload {
  lng: number;
  lat: number;
  min_time: string;
  max_time: string;
  weight: number;
}

export interface Quote {
  id: string;
  window_id: string;
  lng: number;
  lat: number;
  min_time: string;
  max_time: string;
  weight: number;
  created_at: string;
  expires_at: string;
}

export interface Order {
  id: string;
  window_id: string;
  lng: number;
  lat: number;
  weight: number;
  created_at: string;
}

export interface QuoteResult {
  quote_id: string;
  window_id: string;
  team_id: string;
  start_time: string;
  end_time: string;
  expires_at: string;
}

export type BookingResult =
  | { ok: true; order_id: string }
  | { ok: false; reason: 'quote_not_found' | 'payload_mismatch' | 'quote_expired' | 'capacity_exceeded' };
