import type { FastifyInstance, FastifyError } from 'fastify';
import { ERROR_CODES, HTTP_STATUS } from '../config/constants';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err.validation) {
      return reply
        .code(HTTP_STATUS.BAD_REQUEST)
        .send({ error: ERROR_CODES.INVALID_PAYLOAD, details: err.validation });
    }
    app.log.error(err);
    return reply
      .code(HTTP_STATUS.INTERNAL_ERROR)
      .send({ error: ERROR_CODES.INTERNAL_ERROR });
  });
}
