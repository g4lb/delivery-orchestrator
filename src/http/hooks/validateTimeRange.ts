import type { preHandlerHookHandler } from 'fastify';
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from '../../constants';

export const validateTimeRange: preHandlerHookHandler = async (req, reply) => {
  const body = req.body as { min_time?: string; max_time?: string };
  if (body.min_time && body.max_time && body.min_time >= body.max_time) {
    await reply
      .code(HTTP_STATUS.BAD_REQUEST)
      .send({ error: ERROR_CODES.INVALID_PAYLOAD, details: [ERROR_MESSAGES.TIME_RANGE_INVALID] });
  }
};
