import { MAX_WINDOW_WEIGHT_KG } from '../../config/config';
import { ISO_DATETIME_REGEX } from '../../config/constants';

export const bookOrderSchema = {
  type: 'object',
  required: ['quote_id', 'lng', 'lat', 'min_time', 'max_time', 'weight'],
  additionalProperties: false,
  properties: {
    quote_id: { type: 'string', minLength: 1 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
    lat: { type: 'number', minimum: -90, maximum: 90 },
    min_time: { type: 'string', pattern: ISO_DATETIME_REGEX },
    max_time: { type: 'string', pattern: ISO_DATETIME_REGEX },
    weight: { type: 'number', exclusiveMinimum: 0, maximum: MAX_WINDOW_WEIGHT_KG },
  },
} as const;
