import { v4 as uuidv4 } from 'uuid';
import type { Db } from '../db/connection';
import type { QuotesRepo } from '../db/quotesRepo';
import type { OrdersRepo } from '../db/ordersRepo';
import type { Clock } from '../clock';
import { formatIso } from '../clock';
import type { OrderPayload, BookingResult, Quote } from '../types';
import { fits } from '../domain/availability';
import { MAX_WINDOW_WEIGHT_KG } from '../config';

function snapshotMatches(q: Quote, p: OrderPayload): boolean {
  return (
    q.lng === p.lng &&
    q.lat === p.lat &&
    q.min_time === p.min_time &&
    q.max_time === p.max_time &&
    q.weight === p.weight
  );
}

export class BookingService {
  constructor(
    private db: Db,
    private quotes: QuotesRepo,
    private orders: OrdersRepo,
    private clock: Clock,
  ) {}

  book(quoteId: string, submitted: OrderPayload): BookingResult {
    const runTx = this.db.transaction((): BookingResult => {
      const quote = this.quotes.findById(quoteId);
      if (!quote) return { ok: false, reason: 'quote_not_found' };

      if (!snapshotMatches(quote, submitted)) {
        return { ok: false, reason: 'payload_mismatch' };
      }

      const nowIso = formatIso(this.clock.now());
      if (nowIso > quote.expires_at) {
        return { ok: false, reason: 'quote_expired' };
      }

      const used = this.orders.sumWeightByWindow(quote.window_id);
      if (!fits(quote.weight, used, MAX_WINDOW_WEIGHT_KG)) {
        return { ok: false, reason: 'capacity_exceeded' };
      }

      const orderId = uuidv4();
      this.orders.insert({
        id: orderId,
        window_id: quote.window_id,
        lng: quote.lng,
        lat: quote.lat,
        weight: quote.weight,
        created_at: nowIso,
      });
      return { ok: true, order_id: orderId };
    });
    // `better-sqlite3` transactions default to DEFERRED; switch to IMMEDIATE so
    // the write lock is acquired at the start and two concurrent book() calls serialize.
    return runTx.immediate();
  }
}
