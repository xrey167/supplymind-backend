import { describe, test, expect, beforeEach, mock } from 'bun:test';

// ── Mocks (declared before module imports) ──────────────────────────────────

mock.module('../../../config/logger', () => ({
  logger: { info: mock(() => {}), warn: mock(() => {}), debug: mock(() => {}), error: mock(() => {}) },
}));

const mockCreate = mock(async (_data: any) => ({ id: 'orch-1', workspaceId: 'ws-1' }));
const mockGetById = mock(async (_id: string) => null as any);
const mockList = mock(async (_wsId: string) => [] as any[]);
const mockUpdate = mock(async (_id: string, _patch: any) => ({ id: 'tmpl-1' }));
const mockDelete = mock(async (_id: string) => true);

mock.module('../workflows.repo', () => ({
  workflowsRepo: {
    create: mockCreate,
    getById: mockGetById,
    list: mockList,
    update: mockUpdate,
    delete: mockDelete,
  },
}));

const mockOrchCreate = mock(async (_data: any) => ({ id: 'orch-1', workspaceId: 'ws-1' }));
mock.module('../../orchestration/orchestration.repo', () => ({
  orchestrationRepo: { create: mockOrchCreate },
}));

const mockEnqueue = mock(async (_data: any) => {});
mock.module('../../../infra/queue/bullmq', () => ({
  enqueueOrchestration: mockEnqueue,
}));

// ── Import under test (after mocks) ─────────────────────────────────────────

const { workflowsService } = await import('../workflows.service');
import type { AppError } from '../../../core/errors';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TEMPLATE = {
  id: 'tmpl-1',
  workspaceId: 'ws-1',
  name: 'My Workflow',
  description: 'desc',
  definition: { steps: [] },
  createdBy: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('workflowsService', () => {
  beforeEach(() => {
    mockCreate.mockClear();
    mockGetById.mockClear();
    mockList.mockClear();
    mockUpdate.mockClear();
    mockDelete.mockClear();
    mockOrchCreate.mockClear();
    mockEnqueue.mockClear();
    // Default: getById returns null (not found)
    mockGetById.mockImplementation(async () => null);
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    test('calls repo with workspaceId and callerId, returns ok(row)', async () => {
      mockCreate.mockImplementation(async () => TEMPLATE);
      const result = await workflowsService.create('ws-1', 'user-1', {
        name: 'My Workflow',
        description: 'desc',
        definition: { steps: [] },
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual(TEMPLATE);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws-1', createdBy: 'user-1', name: 'My Workflow' }),
      );
    });
  });

  // ── list ───────────────────────────────────────────────────────────────────

  describe('list', () => {
    test('returns ok(rows) from repo', async () => {
      mockList.mockImplementation(async () => [TEMPLATE]);
      const result = await workflowsService.list('ws-1');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual([TEMPLATE]);
    });
  });

  // ── getById ────────────────────────────────────────────────────────────────

  describe('getById', () => {
    test('returns ok(row) when found and workspace matches', async () => {
      mockGetById.mockImplementation(async () => TEMPLATE);
      const result = await workflowsService.getById('tmpl-1', 'ws-1');
      expect(result.ok).toBe(true);
    });

    test('returns NOT_FOUND when row does not exist', async () => {
      const result = await workflowsService.getById('tmpl-missing', 'ws-1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as AppError).statusCode).toBe(404);
        expect((result.error as AppError).code).toBe('NOT_FOUND');
      }
    });

    test('returns NOT_FOUND when row belongs to a different workspace', async () => {
      mockGetById.mockImplementation(async () => ({ ...TEMPLATE, workspaceId: 'ws-other' }));
      const result = await workflowsService.getById('tmpl-1', 'ws-1');
      expect(result.ok).toBe(false);
      if (!result.ok) expect((result.error as AppError).statusCode).toBe(404);
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe('update', () => {
    test('returns ok(updated) when found and workspace matches', async () => {
      mockGetById.mockImplementation(async () => TEMPLATE);
      const updated = { ...TEMPLATE, name: 'Renamed' };
      mockUpdate.mockImplementation(async () => updated);
      const result = await workflowsService.update('tmpl-1', 'ws-1', { name: 'Renamed' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.name).toBe('Renamed');
    });

    test('returns NOT_FOUND when row does not exist', async () => {
      const result = await workflowsService.update('tmpl-missing', 'ws-1', { name: 'X' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect((result.error as AppError).statusCode).toBe(404);
    });

    test('returns NOT_FOUND when row belongs to a different workspace', async () => {
      mockGetById.mockImplementation(async () => ({ ...TEMPLATE, workspaceId: 'ws-other' }));
      const result = await workflowsService.update('tmpl-1', 'ws-1', { name: 'X' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect((result.error as AppError).statusCode).toBe(404);
    });

    test('does not call repo.update when workspace check fails', async () => {
      mockGetById.mockImplementation(async () => ({ ...TEMPLATE, workspaceId: 'ws-other' }));
      await workflowsService.update('tmpl-1', 'ws-1', { name: 'X' });
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  describe('delete', () => {
    test('returns ok(undefined) when found and workspace matches', async () => {
      mockGetById.mockImplementation(async () => TEMPLATE);
      const result = await workflowsService.delete('tmpl-1', 'ws-1');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBeUndefined();
    });

    test('returns NOT_FOUND when row does not exist', async () => {
      const result = await workflowsService.delete('tmpl-missing', 'ws-1');
      expect(result.ok).toBe(false);
      if (!result.ok) expect((result.error as AppError).statusCode).toBe(404);
    });

    test('returns NOT_FOUND when row belongs to a different workspace', async () => {
      mockGetById.mockImplementation(async () => ({ ...TEMPLATE, workspaceId: 'ws-other' }));
      const result = await workflowsService.delete('tmpl-1', 'ws-1');
      expect(result.ok).toBe(false);
      if (!result.ok) expect((result.error as AppError).statusCode).toBe(404);
    });

    test('does not call repo.delete when workspace check fails', async () => {
      mockGetById.mockImplementation(async () => ({ ...TEMPLATE, workspaceId: 'ws-other' }));
      await workflowsService.delete('tmpl-1', 'ws-1');
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  // ── runTemplate ────────────────────────────────────────────────────────────

  describe('runTemplate', () => {
    beforeEach(() => {
      mockGetById.mockImplementation(async () => TEMPLATE);
      mockOrchCreate.mockImplementation(async () => ({ id: 'orch-1', workspaceId: 'ws-1' }));
      mockEnqueue.mockImplementation(async () => {});
    });

    test('returns NOT_FOUND when template does not exist', async () => {
      mockGetById.mockImplementation(async () => null);
      const result = await workflowsService.runTemplate('tmpl-missing', 'ws-1');
      expect(result.ok).toBe(false);
      if (!result.ok) expect((result.error as AppError).statusCode).toBe(404);
    });

    test('returns NOT_FOUND when template belongs to a different workspace', async () => {
      mockGetById.mockImplementation(async () => ({ ...TEMPLATE, workspaceId: 'ws-other' }));
      const result = await workflowsService.runTemplate('tmpl-1', 'ws-1');
      expect(result.ok).toBe(false);
      if (!result.ok) expect((result.error as AppError).statusCode).toBe(404);
    });

    test('creates orchestration record and enqueues job on success', async () => {
      await workflowsService.runTemplate('tmpl-1', 'ws-1');
      expect(mockOrchCreate).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
    });

    test('returns ok({ orchestrationId }) on success', async () => {
      const result = await workflowsService.runTemplate('tmpl-1', 'ws-1');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({ orchestrationId: 'orch-1' });
    });

    test('returns QUEUE_UNAVAILABLE when enqueueOrchestration throws', async () => {
      mockEnqueue.mockImplementation(async () => { throw new Error('Redis connection refused'); });
      const result = await workflowsService.runTemplate('tmpl-1', 'ws-1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as AppError).statusCode).toBe(503);
        expect((result.error as AppError).code).toBe('QUEUE_UNAVAILABLE');
      }
    });

    test('does not call enqueue when workspace check fails', async () => {
      mockGetById.mockImplementation(async () => ({ ...TEMPLATE, workspaceId: 'ws-other' }));
      await workflowsService.runTemplate('tmpl-1', 'ws-1');
      expect(mockEnqueue).not.toHaveBeenCalled();
      expect(mockOrchCreate).not.toHaveBeenCalled();
    });

    test('passes sessionId and input through to orchestration create', async () => {
      await workflowsService.runTemplate('tmpl-1', 'ws-1', 'session-abc', { key: 'value' });
      expect(mockOrchCreate).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-abc', input: { key: 'value' } }),
      );
    });

    test('uses empty object as input default when input is undefined', async () => {
      await workflowsService.runTemplate('tmpl-1', 'ws-1');
      expect(mockOrchCreate).toHaveBeenCalledWith(
        expect.objectContaining({ input: {} }),
      );
      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ input: {} }),
      );
    });
  });
});
