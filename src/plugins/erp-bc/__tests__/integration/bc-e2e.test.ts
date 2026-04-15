/**
 * Integration tests for the ERP BC connector against a real Business Central sandbox.
 *
 * All tests skip gracefully when BC credentials are absent from the environment.
 * To run against a real sandbox:
 *   1. Set the env vars below in .env.test (or export them in your shell)
 *   2. Run: bun test src/plugins/erp-bc/__tests__/integration/bc-e2e.test.ts
 *
 * Required env vars:
 *   BC_TENANT_ID       — Azure AD tenant ID
 *   BC_CLIENT_ID       — App registration client ID
 *   BC_CLIENT_SECRET   — App registration client secret
 *   BC_BASE_URL        — e.g. https://api.businesscentral.dynamics.com/v2.0/{tenantId}/Production/ODataV4
 *   BC_COMPANY_ID      — Business Central company GUID
 */

import { describe, it, expect } from 'bun:test';
import { getToken } from '../../connector/bc-auth';
import { BcClient } from '../../connector/bc-client';
import { upsertSyncSchedule, removeSyncSchedule } from '../../../../jobs/erp-sync-scheduler';

// ---------------------------------------------------------------------------
// Credential guards
// ---------------------------------------------------------------------------

const BC_TENANT_ID = Bun.env.BC_TENANT_ID;
const BC_CLIENT_ID = Bun.env.BC_CLIENT_ID;
const BC_CLIENT_SECRET = Bun.env.BC_CLIENT_SECRET;
const BC_BASE_URL = Bun.env.BC_BASE_URL;
const BC_COMPANY_ID = Bun.env.BC_COMPANY_ID;
const REDIS_URL = Bun.env.REDIS_URL;

const SKIP_BC = !BC_TENANT_ID || !BC_CLIENT_ID || !BC_CLIENT_SECRET || !BC_BASE_URL || !BC_COMPANY_ID;
const SKIP_REDIS = !REDIS_URL;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A minimal in-process token cache backed by a plain object — no Redis needed
 * for the BC connector tests.
 */
function makeMemoryCache() {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      if (!entry || entry.expiresAt <= Date.now()) return null;
      return entry.value;
    },
    async set(key: string, value: string, ttlMs: number): Promise<void> {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
  };
}

/**
 * Wraps a test in a skip-when-condition-is-true guard.
 * The test itself is always registered so bun:test sees it, but it returns
 * early (with a console.log) when credentials are absent — no assertion fires.
 */
function skipIf(condition: boolean, name: string, fn: () => Promise<void>) {
  it(name, async () => {
    if (condition) {
      console.log(`SKIP: ${name} — credentials/infra not available`);
      return;
    }
    await fn();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ERP BC — real sandbox integration', () => {
  // -------------------------------------------------------------------------
  // Test 1: Azure AD authentication
  // -------------------------------------------------------------------------
  skipIf(SKIP_BC, 'authenticates with Azure AD and returns a valid token', async () => {
    const cache = makeMemoryCache();

    const token = await getToken(
      BC_TENANT_ID!,
      BC_CLIENT_ID!,
      BC_CLIENT_SECRET!,
      cache,
    );

    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    // Decode JWT payload (second segment) without an external library
    const segments = token.split('.');
    expect(segments.length).toBeGreaterThanOrEqual(3); // header.payload.signature

    const payloadJson = Buffer.from(
      // base64url → base64: replace - with + and _ with /
      segments[1].replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf-8');

    const payload = JSON.parse(payloadJson) as { exp: number; aud?: string };

    // Token must not be expired
    expect(payload.exp).toBeGreaterThan(Date.now() / 1000);
  });

  // -------------------------------------------------------------------------
  // Test 2: List purchase orders
  // -------------------------------------------------------------------------
  skipIf(SKIP_BC, "lists purchase orders (top 5)", async () => {
    const client = new BcClient(
      {
        tenantId: BC_TENANT_ID!,
        clientId: BC_CLIENT_ID!,
        clientSecret: BC_CLIENT_SECRET!,
        baseUrl: BC_BASE_URL!,
        companyId: BC_COMPANY_ID!,
      },
      makeMemoryCache(),
    );

    const response = await client.list('purchaseOrders', { top: 5 });

    expect(Array.isArray(response.value)).toBe(true);

    for (const item of response.value) {
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // Test 3: Fetch a single vendor by id
  // -------------------------------------------------------------------------
  skipIf(SKIP_BC, 'fetches a single vendor by id', async () => {
    const client = new BcClient(
      {
        tenantId: BC_TENANT_ID!,
        clientId: BC_CLIENT_ID!,
        clientSecret: BC_CLIENT_SECRET!,
        baseUrl: BC_BASE_URL!,
        companyId: BC_COMPANY_ID!,
      },
      makeMemoryCache(),
    );

    const listResult = await client.list('vendors', { top: 1 });

    if (listResult.value.length === 0) {
      console.log('SKIP (sub-assertion): no vendors in sandbox — skipping get() check');
      return;
    }

    const firstVendor = listResult.value[0];
    const vendor = await client.get('vendors', firstVendor.id);

    expect(typeof vendor.id).toBe('string');
    expect(vendor.id).toBe(firstVendor.id);
  });

  // -------------------------------------------------------------------------
  // Test 4: Incremental sync cursor
  //
  // runSync() reads from and writes to a real DB row (sync_jobs table).
  // Without a test DB with a seeded sync_jobs row, this cannot run end-to-end.
  // Skipped with a clear comment instead of a flaky DB dependency.
  // -------------------------------------------------------------------------
  it.skip(
    // Requires a test DB with a real sync_jobs row — run manually with:
    //   bun run test:integration
    // After seeding a sync_jobs row pointing to a real BC installation.
    'incremental sync with cursor returns fewer or equal records than full sync',
    async () => {
      // This test needs:
      //   1. A running Postgres instance with the schema migrated (bun run db:migrate:test)
      //   2. A seeded sync_jobs row (jobId) that references a valid plugin_installations row
      //   3. A BcClient configured against the sandbox
      //
      // Example manual steps:
      //   const jobId = '<uuid from sync_jobs table>';
      //   const client = new BcClient({ ... }, makeMemoryCache());
      //   const notify = async () => {};
      //
      //   // Full sync (cursor = null in DB)
      //   const full = await runSync(jobId, client, notify);
      //
      //   // Incremental sync (set cursor to a time slightly before now)
      //   await db.update(syncJobs).set({ cursor: new Date(Date.now() - 60_000).toISOString() }).where(eq(syncJobs.id, jobId));
      //   const incremental = await runSync(jobId, client, notify);
      //
      //   expect(incremental.created).toBeLessThanOrEqual(full.created);
    },
  );

  // -------------------------------------------------------------------------
  // Test 5: Scheduler integration — upsertSyncSchedule / removeSyncSchedule
  // -------------------------------------------------------------------------
  skipIf(
    SKIP_REDIS,
    "upsertSyncSchedule registers repeatable job in BullMQ",
    async () => {
      // Belt-and-suspenders: if bullmq was mocked by a unit test in the same
      // process, upsertJobScheduler won't exist — skip gracefully.
      const { Queue: ProbeQueue } = await import('bullmq');
      if (typeof (ProbeQueue.prototype as any).upsertJobScheduler !== 'function') {
        console.log('SKIP: upsertSyncSchedule — bullmq mocked in shared test process');
        return;
      }

      const testJobId = 'integration-test-job';
      const testPattern = '*/30 * * * *';
      const expectedKey = `erp-sync-cron:${testJobId}`;

      // Register the schedule
      await upsertSyncSchedule(testJobId, testPattern);

      // Verify it shows up in the queue's job schedulers
      // BullMQ v5+ exposes getJobSchedulers() on Queue
      const { Queue } = await import('bullmq');
      const { redis: connection } = await import('../../../../infra/queue/bullmq');
      const queue = new Queue('erp-sync', { connection });

      try {
        const schedulers = await queue.getJobSchedulers();
        const found = schedulers.find((s: { key: string }) => s.key === expectedKey);

        expect(found).toBeDefined();
        expect(found!.pattern).toBe(testPattern);
      } finally {
        // Always clean up — remove the test scheduler and close the queue
        await removeSyncSchedule(testJobId);
        await queue.close();
      }
    },
  );
});
