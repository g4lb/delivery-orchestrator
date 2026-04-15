import type { FastifyReply } from 'fastify';

/**
 * Enforces `min_time < max_time` on a payload that has already passed JSON
 * schema validation. JSON schema can validate string shape but not a
 * cross-field inequality, so this lives in code.
 *
 * If the check fails, writes a 400 `invalid_payload` response and returns
 * `true` (meaning: caller should stop processing). Returns `false` on success.
 */
export function rejectIfTimeRangeInvalid(
  body: { min_time: string; max_time: string },
  reply: FastifyReply,
): boolean {
  if (body.min_time >= body.max_time) {
    void reply.code(400).send({ error: 'invalid_payload', details: ['min_time must be < max_time'] });
    return true;
  }
  return false;
}
