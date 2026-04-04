import type { ErrorHandler } from 'hono';
import { AppError } from '../../core/errors';
import { logger } from '../../config/logger';
import { captureException } from '../../infra/observability/sentry';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      captureException(err, { code: err.code, path: c.req.path });
    }
    return c.json({ error: { code: err.code, message: err.message } }, err.statusCode as any);
  }

  captureException(err, { path: c.req.path, method: c.req.method });
  logger.error({ err }, 'Unhandled error');
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
};
