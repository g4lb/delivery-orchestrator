import { openDb, type Db } from '../../src/db/connection';
import { TeamsRepo } from '../../src/db/teamsRepo';
import { WindowsRepo } from '../../src/db/windowsRepo';
import { QuotesRepo } from '../../src/db/quotesRepo';
import { OrdersRepo } from '../../src/db/ordersRepo';
import { BookingService } from '../../src/services/bookingService';
import { FakeClock } from '../../src/clock';
import { makeTeam, makeWindow, makeOrder, makeOrderPayload } from '../helpers/fixtures';
import type { Quote } from '../../src/types';

const NOW = new Date('2026-04-14T12:00:00Z');

function setup() {
  const db: Db = openDb();
  const teams = new TeamsRepo(db);
  const windows = new WindowsRepo(db);
  const quotes = new QuotesRepo(db);
  const orders = new OrdersRepo(db);
  const clock = new FakeClock(NOW);
  const service = new BookingService(db, windows, quotes, orders, clock);
  teams.insert(makeTeam());
  return { db, teams, windows, quotes, orders, clock, service };
}

function seedQuote(
  quotes: QuotesRepo,
  overrides: Partial<Quote> = {},
): Quote {
  const q: Quote = {
    id: 'q-default',
    window_id: 'win-default',
    lng: 34.78,
    lat: 32.08,
    min_time: '2026-04-15 09:00:00',
    max_time: '2026-04-15 13:00:00',
    weight: 100,
    created_at: '2026-04-14 12:00:00',
    expires_at: '2026-04-14 12:05:00',
    ...overrides,
  };
  quotes.insertMany([q]);
  return q;
}

describe('BookingService.book', () => {
  it('happy path inserts an order and returns order_id', () => {
    const { windows, quotes, service, db } = setup();
    windows.insert(makeWindow());
    const q = seedQuote(quotes);
    const result = service.book(q.id, makeOrderPayload());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order_id).toMatch(/^[0-9a-f-]{36}$/);
    db.close();
  });

  it('returns quote_not_found for unknown quote', () => {
    const { service, db } = setup();
    const result = service.book('does-not-exist', makeOrderPayload());
    expect(result).toEqual({ ok: false, reason: 'quote_not_found' });
    db.close();
  });

  it('returns quote_expired when clock has advanced past expires_at', () => {
    const { windows, quotes, clock, service, db } = setup();
    windows.insert(makeWindow());
    const q = seedQuote(quotes);
    clock.advanceMs(6 * 60 * 1000);
    const result = service.book(q.id, makeOrderPayload());
    expect(result).toEqual({ ok: false, reason: 'quote_expired' });
    db.close();
  });

  it.each([
    ['lng', { lng: 35 }],
    ['lat', { lat: 33 }],
    ['min_time', { min_time: '2026-04-15 09:00:01' }],
    ['max_time', { max_time: '2026-04-15 13:00:01' }],
    ['weight', { weight: 101 }],
  ])('returns payload_mismatch when %s differs', (_field, override) => {
    const { windows, quotes, service, db } = setup();
    windows.insert(makeWindow());
    const q = seedQuote(quotes);
    const result = service.book(q.id, makeOrderPayload(override));
    expect(result).toEqual({ ok: false, reason: 'payload_mismatch' });
    db.close();
  });

  it('returns capacity_exceeded when re-check fails', () => {
    const { windows, quotes, orders, service, db } = setup();
    windows.insert(makeWindow());
    // Pre-fill window to 995 kg, then try to book a 100 kg quote (total 1095 > 1000)
    orders.insert(makeOrder({ id: 'o-fill', window_id: 'win-default', weight: 995 }));
    const q = seedQuote(quotes);
    const result = service.book(q.id, makeOrderPayload());
    expect(result).toEqual({ ok: false, reason: 'capacity_exceeded' });
    db.close();
  });

  it('allows same quote to book twice when capacity permits (no consumption semantics)', () => {
    const { windows, quotes, service, db } = setup();
    windows.insert(makeWindow());
    const q = seedQuote(quotes);
    const r1 = service.book(q.id, makeOrderPayload());
    const r2 = service.book(q.id, makeOrderPayload());
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    const sum = db.prepare('SELECT COALESCE(SUM(weight),0) AS s FROM orders').get() as { s: number };
    expect(sum.s).toBe(200);
    db.close();
  });
});
