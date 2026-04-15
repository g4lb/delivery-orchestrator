import { v4 as uuidv4 } from 'uuid';
import type { Db } from '../db/connection';
import type { QuotesRepo } from '../db/quotesRepo';
import type { OrdersRepo } from '../db/ordersRepo';
import type { Clock } from '../clock';
import { formatIso } from '../clock';
import type { OrderPayload, BookingResult, Quote, Order } from '../types';
import { fits } from '../domain/availability';
import { MAX_WINDOW_WEIGHT_KG } from '../config';
import { ERROR_CODES } from '../constants';

export class BookingService {
  constructor(
    private db: Db,
    private quotes: QuotesRepo,
    private orders: OrdersRepo,
    private clock: Clock,
  ) {}

  book(quoteId: string, submitted: OrderPayload): BookingResult {
    const runTx = this.db.transaction((): BookingResult => this.attemptBook(quoteId, submitted));
    return runTx.immediate();
  }

  private attemptBook(quoteId: string, submitted: OrderPayload): BookingResult {
    const quote = this.quotes.findById(quoteId);
    if (!quote) return { ok: false, reason: ERROR_CODES.QUOTE_NOT_FOUND };

    const validation = this.validateQuote(quote, submitted);
    if (validation) return validation;

    const capacityCheck = this.checkCapacity(quote);
    if (capacityCheck) return capacityCheck;

    const order = this.insertOrder(quote);
    return { ok: true, order_id: order.id };
  }

  private validateQuote(quote: Quote, submitted: OrderPayload): BookingResult | null {
    if (!snapshotMatches(quote, submitted)) {
      return { ok: false, reason: ERROR_CODES.PAYLOAD_MISMATCH };
    }
    if (this.isExpired(quote)) {
      return { ok: false, reason: ERROR_CODES.QUOTE_EXPIRED };
    }
    return null;
  }

  private isExpired(quote: Quote): boolean {
    return formatIso(this.clock.now()) > quote.expires_at;
  }

  private checkCapacity(quote: Quote): BookingResult | null {
    const used = this.orders.sumWeightByWindow(quote.window_id);
    if (!fits(quote.weight, used, MAX_WINDOW_WEIGHT_KG)) {
      return { ok: false, reason: ERROR_CODES.CAPACITY_EXCEEDED };
    }
    return null;
  }

  private insertOrder(quote: Quote): Order {
    const order: Order = {
      id: uuidv4(),
      window_id: quote.window_id,
      lng: quote.lng,
      lat: quote.lat,
      weight: quote.weight,
      created_at: formatIso(this.clock.now()),
    };
    this.orders.insert(order);
    return order;
  }
}

function snapshotMatches(q: Quote, p: OrderPayload): boolean {
  return (
    q.lng === p.lng &&
    q.lat === p.lat &&
    q.min_time === p.min_time &&
    q.max_time === p.max_time &&
    q.weight === p.weight
  );
}
