import type { FastifyInstance } from 'fastify';
import type { BookingService } from '../../services/bookingService';
import type { OrderPayload } from '../../shared/types';
import { bookOrderSchema } from '../schemas/bookOrder.schema';
import { validateTimeRange } from '../hooks/validateTimeRange';
import { HTTP_STATUS, REASON_TO_STATUS } from '../../config/constants';

type BookOrderBody = OrderPayload & { quote_id: string };

export function registerBookOrderRoute(app: FastifyInstance, service: BookingService): void {
  app.post('/book_order', {
    schema: { body: bookOrderSchema },
    preHandler: validateTimeRange,
  }, async (req, reply) => {
    const { quote_id, ...payload } = req.body as BookOrderBody;
    const result = service.book(quote_id, payload);
    if (result.ok) {
      return reply.code(HTTP_STATUS.OK).send({ order_id: result.order_id });
    }
    return reply.code(REASON_TO_STATUS[result.reason]!).send({ error: result.reason });
  });
}
