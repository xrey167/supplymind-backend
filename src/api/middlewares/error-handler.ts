import type { ErrorHandler } from 'hono';
import { AppError } from '../../core/errors';
import { logger } from '../../config/logger';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.statusCode as any);
  }
  logger.error({ err }, 'Unhandled error');
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
};
