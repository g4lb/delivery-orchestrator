import type { FastifyInstance } from 'fastify';
import type { BookingService } from '../../services/bookingService';
import { MAX_WINDOW_WEIGHT_KG } from '../../config';
import { rejectIfTimeRangeInvalid } from '../validation';

const bookOrderSchema = {
  type: 'object',
  required: ['quote_id', 'lng', 'lat', 'min_time', 'max_time', 'weight'],
  additionalProperties: false,
  properties: {
    quote_id: { type: 'string', minLength: 1 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
    lat: { type: 'number', minimum: -90, maximum: 90 },
    min_time: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$' },
    max_time: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$' },
    weight: { type: 'number', exclusiveMinimum: 0, maximum: MAX_WINDOW_WEIGHT_KG },
  },
} as const;

const REASON_TO_STATUS: Record<string, number> = {
  quote_not_found: 404,
  payload_mismatch: 400,
  quote_expired: 410,
  capacity_exceeded: 409,
};

export function registerBookOrderRoute(app: FastifyInstance, service: BookingService): void {
  app.post('/book_order', { schema: { body: bookOrderSchema } }, async (req, reply) => {
    const body = req.body as {
      quote_id: string; lng: number; lat: number; min_time: string; max_time: string; weight: number;
    };
    if (rejectIfTimeRangeInvalid(body, reply)) return;
    const { quote_id, ...payload } = body;
    const result = service.book(quote_id, payload);
    if (result.ok) {
      return reply.code(200).send({ order_id: result.order_id });
    }
    return reply.code(REASON_TO_STATUS[result.reason]!).send({ error: result.reason });
  });
}
