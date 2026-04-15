export const ISO_DATETIME_REGEX = '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$';

export const ERROR_CODES = {
  INVALID_PAYLOAD: 'invalid_payload',
  INTERNAL_ERROR: 'internal_error',
  QUOTE_NOT_FOUND: 'quote_not_found',
  QUOTE_EXPIRED: 'quote_expired',
  PAYLOAD_MISMATCH: 'payload_mismatch',
  CAPACITY_EXCEEDED: 'capacity_exceeded',
} as const;

export const ERROR_MESSAGES = {
  TIME_RANGE_INVALID: 'min_time must be < max_time',
} as const;

export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  INTERNAL_ERROR: 500,
} as const;

export const REASON_TO_STATUS: Record<string, number> = {
  [ERROR_CODES.QUOTE_NOT_FOUND]: HTTP_STATUS.NOT_FOUND,
  [ERROR_CODES.PAYLOAD_MISMATCH]: HTTP_STATUS.BAD_REQUEST,
  [ERROR_CODES.QUOTE_EXPIRED]: HTTP_STATUS.GONE,
  [ERROR_CODES.CAPACITY_EXCEEDED]: HTTP_STATUS.CONFLICT,
};
