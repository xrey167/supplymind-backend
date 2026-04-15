import { describe, it, expect, mock, afterAll, beforeEach, afterEach } from 'bun:test';

// Track Sentry calls
const sentryMock = {
  init: mock(() => {}),
  withScope: mock((fn: (scope: unknown) => void) => fn(scopeMock)),
  captureException: mock(() => {}),
  setUser: mock(() => {}),
  autoDiscoverNodePerformanceMonitoringIntegrations: mock(() => []),
};

const scopeMock = {
  setExtras: mock(() => {}),
};

const _realSentryNode = require('@sentry/node');
mock.module('@sentry/node', () => ({ ..._realSentryNode, ...sentryMock }));

const _realLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({
  ..._realLogger,
  logger: {
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
  },
}));

// Import the module fresh each test group via dynamic import would be ideal,
// but since bun:test runs in one context we reset initialized state by
// re-importing and testing the public contract only.
const { initSentry, captureException, setUser } = await import('../sentry');

describe('sentry — no DSN configured', () => {
  beforeEach(() => {
    delete process.env.SENTRY_DSN;
    sentryMock.init.mockClear();
    sentryMock.captureException.mockClear();
    sentryMock.setUser.mockClear();
    sentryMock.withScope.mockClear();
    scopeMock.setExtras.mockClear();
  });

  it('initSentry does not call Sentry.init when SENTRY_DSN is absent', () => {
    initSentry();
    expect(sentryMock.init).not.toHaveBeenCalled();
  });

  it('captureException does nothing when not initialized', () => {
    captureException(new Error('noop'));
    expect(sentryMock.withScope).not.toHaveBeenCalled();
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });

  it('setUser does nothing when not initialized', () => {
    setUser('user-1', { email: 'test@example.com' });
    expect(sentryMock.setUser).not.toHaveBeenCalled();
  });
});

describe('sentry — DSN present (simulated initialization)', () => {
  // Because the `initialized` flag is module-level and the module has already
  // been imported above (without DSN), Sentry.init was never called.
  // To test the "initialized" path we use a fresh dynamic import with a reset.
  // Bun module cache makes true re-import tricky, so we test the guards by
  // directly verifying behavior: if init was called with DSN, subsequent
  // captureException/setUser delegates to Sentry.

  it('initSentry calls Sentry.init with dsn and environment when DSN is set (fresh module)', async () => {
    // Reset mock counters
    sentryMock.init.mockClear();

    // Force a fresh module load by reloading — bun supports cache-busting via ?v param trick
    // Instead, verify that once initialized flag becomes true, init is called.
    process.env.SENTRY_DSN = 'https://test@sentry.io/123';
    process.env.NODE_ENV = 'test';

    // We need a fresh import to bypass the initialized guard.
    // Use a workaround: import with a cache-busting query string.
    const freshModule = await import('../sentry?fresh=1' as string);
    freshModule.initSentry();

    expect(sentryMock.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://test@sentry.io/123',
      }),
    );

    delete process.env.SENTRY_DSN;
  });

  it('captureException delegates to Sentry.withScope when initialized', async () => {
    // Use the fresh module from above (already initialized in that import)
    process.env.SENTRY_DSN = 'https://test@sentry.io/123';
    const freshModule = await import('../sentry?fresh=2' as string);
    freshModule.initSentry();

    sentryMock.withScope.mockClear();
    sentryMock.captureException.mockClear();

    const err = new Error('test error');
    freshModule.captureException(err, { userId: 'u-1' });

    expect(sentryMock.withScope).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException).toHaveBeenCalledWith(err);
    expect(scopeMock.setExtras).toHaveBeenCalledWith({ userId: 'u-1' });

    delete process.env.SENTRY_DSN;
  });

  it('setUser delegates to Sentry.setUser when initialized', async () => {
    process.env.SENTRY_DSN = 'https://test@sentry.io/123';
    const freshModule = await import('../sentry?fresh=3' as string);
    freshModule.initSentry();

    sentryMock.setUser.mockClear();
    freshModule.setUser('user-42', { role: 'admin' });

    expect(sentryMock.setUser).toHaveBeenCalledWith({ id: 'user-42', role: 'admin' });

    delete process.env.SENTRY_DSN;
  });

  it('initSentry only calls Sentry.init once (idempotent)', async () => {
    process.env.SENTRY_DSN = 'https://test@sentry.io/123';
    const freshModule = await import('../sentry?fresh=4' as string);

    sentryMock.init.mockClear();
    freshModule.initSentry();
    freshModule.initSentry();
    freshModule.initSentry();

    expect(sentryMock.init).toHaveBeenCalledTimes(1);

    delete process.env.SENTRY_DSN;
  });
});

afterAll(() => mock.restore());
