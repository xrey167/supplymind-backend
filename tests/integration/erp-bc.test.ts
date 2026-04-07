import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestApp, authHeader, seedWorkspace, truncateTables } from './helpers';
import { testDb } from './helpers/db';
import { pluginInstallations, syncJobs } from '../../src/infra/db/schema';
import { erpBcManifest } from '../../src/plugins/erp-bc/manifest';
import { HITL_REQUIRED_ACTIONS } from '../../src/plugins/erp-bc/skills/post-action';
import { classifyByRules } from '../../src/modules/execution/intent-gate';
import type { ExecutionStep } from '../../src/modules/execution/execution.types';

describe('ERP BC Plugin', () => {
  let app: Awaited<ReturnType<typeof getTestApp>>;
  let workspaceId: string;
  let userId: string;
  let installationId: string;
  let dbAvailable = false;

  beforeAll(async () => {
    try {
      app = await getTestApp();
      const seed = await seedWorkspace({ name: 'ERP BC Test WS' });
      workspaceId = seed.workspaceId;
      userId = seed.userId;

      // Seed a plugin installation (FK anchor for sync_jobs)
      const [installation] = await testDb.insert(pluginInstallations).values({
        workspaceId,
        pluginId: erpBcManifest.id,
        config: {},
        enabled: true,
        installedBy: userId,
      }).returning({ id: pluginInstallations.id });
      installationId = installation!.id;
      dbAvailable = true;
    } catch (e: any) {
      // DB tables may not be migrated in CI — non-DB tests still run
      console.warn('[erp-bc.test] DB setup skipped:', e?.message ?? e);
    }
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    try {
      await truncateTables(
        'sync_records', 'sync_jobs', 'execution_runs', 'execution_plans',
        'plugin_installations',
        'workspace_members', 'workspaces', 'users',
      );
    } catch (e: any) {
      console.warn('[erp-bc.test] afterAll truncate failed:', e?.message ?? e);
    }
  });

  const hdrs = () => ({ 'Content-Type': 'application/json', ...authHeader(userId ?? 'test-user', 'admin') });

  // ── Pure (no-DB) tests ────────────────────────────────────────────────────

  describe('Plugin manifest', () => {
    it('manifest has required fields', () => {
      expect(erpBcManifest.id).toBe('erp-bc');
      expect(erpBcManifest.version).toBe('1.0.0');
      expect(HITL_REQUIRED_ACTIONS.has('postInvoice')).toBe(true);
      expect(erpBcManifest.skills).toHaveLength(3);
    });

    it('manifest skills have required handler functions', () => {
      for (const skill of erpBcManifest.skills ?? []) {
        expect(typeof skill.handler).toBe('function');
        expect(skill.name).toMatch(/^erp-bc:/);
      }
    });
  });

  describe('Error classification', () => {
    it('classifyHttpError returns correct types', async () => {
      const { classifyHttpError, AuthError, PermanentError, TransientError } =
        await import('../../src/plugins/erp-bc/sync/sync-errors');
      expect(classifyHttpError(401, '')).toBeInstanceOf(AuthError);
      expect(classifyHttpError(400, '')).toBeInstanceOf(PermanentError);
      expect(classifyHttpError(500, '')).toBeInstanceOf(TransientError);
    });
  });

  describe('HITL Intent-Gate', () => {
    it('write action steps classified as ops + require_approval by rules', () => {
      const steps: ExecutionStep[] = [
        {
          id: 'gate',
          type: 'gate',
          gatePrompt: 'Approve invoice posting',
          riskClass: 'critical',
          approvalMode: 'required',
        },
        {
          id: 'execute',
          type: 'skill',
          skillId: 'erp-bc:post-action',
          riskClass: 'critical',
          dependsOn: ['gate'],
        },
      ];
      const classification = classifyByRules(steps);
      expect(classification?.category).toBe('ops');
      expect(classification?.confidence).toBeGreaterThan(0.9);
    });
  });

  describe('Retry strategy', () => {
    it('withRetry succeeds on second attempt after TransientError', async () => {
      const { withRetry } = await import('../../src/plugins/erp-bc/sync/retry-strategy');
      const { TransientError } = await import('../../src/plugins/erp-bc/sync/sync-errors');
      let calls = 0;
      const result = await withRetry(
        async () => { calls++; if (calls < 2) throw new TransientError('net'); return 'ok'; },
        { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 },
      );
      expect(result).toBe('ok');
      expect(calls).toBe(2);
    });
  });

  // ── DB-dependent tests ────────────────────────────────────────────────────

  describe('Sync job creation', () => {
    it('creates sync_job row via DB', async () => {
      if (!dbAvailable) {
        console.log('[SKIP] DB not available');
        return;
      }
      const [job] = await testDb.insert(syncJobs).values({
        installationId,
        workspaceId,
        entityType: 'purchaseOrders',
        status: 'idle',
        batchSize: 100,
      }).returning();
      expect(job!.entityType).toBe('purchaseOrders');
      expect(job!.status).toBe('idle');
      expect(job!.workspaceId).toBe(workspaceId);
    });
  });
});
