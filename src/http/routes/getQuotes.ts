import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { QuotingService } from '../../services/quotingService';
import type { OrderPayload } from '../../types';
import { orderPayloadSchema } from '../schemas/orderPayload.schema';
import { validateTimeRange } from '../hooks/validateTimeRange';
import { HTTP_STATUS } from '../../constants';

export function registerGetQuotesRoute(app: FastifyInstance, service: QuotingService): void {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const quotes = service.getQuotes(req.body as OrderPayload);
    return reply.code(HTTP_STATUS.OK).send({ quotes });
  };

  app.post('/get_quotes', {
    schema: { body: orderPayloadSchema },
    preHandler: validateTimeRange,
  }, handler);

  app.get('/get_quotes', handler);
}
