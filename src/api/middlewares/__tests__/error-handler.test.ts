import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { Hono } from 'hono';

// Mock captureException so Sentry is never called for real
const captureExceptionMock = mock(() => {});

mock.module('../../../infra/observability/sentry', () => ({
  captureException: captureExceptionMock,
  setUser: mock(() => {}),
  initSentry: mock(() => {}),
  Sentry: {},
}));

mock.module('../../../config/logger', () => ({
  logger: {
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
  },
}));

const { errorHandler } = await import('../error-handler');
const { AppError } = await import('../../../core/errors');

function buildApp(throwFn: () => never) {
  const app = new Hono();
  app.onError(errorHandler);
  app.get('/test', () => {
    throwFn();
  });
  return app;
}

describe('errorHandler', () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
  });

  it('returns correct JSON shape for a 4xx AppError', async () => {
    const app = buildApp(() => {
      throw new AppError('Not found', 404, 'NOT_FOUND');
    });
    const res = await app.request('/test');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  it('does not call captureException for 4xx AppError', async () => {
    const app = buildApp(() => {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    });
    await app.request('/test');
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('returns correct JSON shape for a 5xx AppError', async () => {
    const app = buildApp(() => {
      throw new AppError('Something broke', 500, 'SERVER_ERROR');
    });
    const res = await app.request('/test');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: { code: 'SERVER_ERROR', message: 'Something broke' } });
  });

  it('calls captureException for 5xx AppError', async () => {
    const app = buildApp(() => {
      throw new AppError('Internal failure', 503, 'UNAVAILABLE');
    });
    await app.request('/test');
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('returns 500 with INTERNAL_ERROR code for unknown errors', async () => {
    const app = buildApp(() => {
      throw new Error('Something unexpected');
    });
    const res = await app.request('/test');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  it('calls captureException for unknown errors', async () => {
    const app = buildApp(() => {
      throw new Error('unexpected');
    });
    await app.request('/test');
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('response error object has code and message keys', async () => {
    const app = buildApp(() => {
      throw new AppError('Bad request', 400, 'BAD_REQUEST');
    });
    const res = await app.request('/test');
    const body = await res.json();
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
  });

  it('handles AppError with undefined code', async () => {
    const app = buildApp(() => {
      throw new AppError('Oops', 422);
    });
    const res = await app.request('/test');
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.message).toBe('Oops');
    expect(body.error.code).toBeUndefined();
  });
});
