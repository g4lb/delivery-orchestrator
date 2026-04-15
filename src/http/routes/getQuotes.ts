import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { QuotingService } from '../../services/quotingService';
import { MAX_WINDOW_WEIGHT_KG } from '../../config';
import { rejectIfTimeRangeInvalid } from '../validation';

const orderPayloadSchema = {
  type: 'object',
  required: ['lng', 'lat', 'min_time', 'max_time', 'weight'],
  additionalProperties: false,
  properties: {
    lng: { type: 'number', minimum: -180, maximum: 180 },
    lat: { type: 'number', minimum: -90, maximum: 90 },
    min_time: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$' },
    max_time: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$' },
    weight: { type: 'number', exclusiveMinimum: 0, maximum: MAX_WINDOW_WEIGHT_KG },
  },
} as const;

export function registerGetQuotesRoute(app: FastifyInstance, service: QuotingService): void {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      lng: number; lat: number; min_time: string; max_time: string; weight: number;
    };
    if (rejectIfTimeRangeInvalid(body, reply)) return;
    const quotes = service.getQuotes(body);
    return reply.code(200).send({ quotes });
  };

  app.post('/get_quotes', { schema: { body: orderPayloadSchema } }, handler);
  app.get('/get_quotes', handler);
}
