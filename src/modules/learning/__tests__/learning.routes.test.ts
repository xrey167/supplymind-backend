import { mock, describe, it, expect, beforeEach } from 'bun:test';

// --- Mock functions ---

const mockListFiltered = mock(() => Promise.resolve([]));
const mockGetById = mock(() => Promise.resolve(null));
const mockApprove = mock(() => Promise.resolve());
const mockReject = mock(() => Promise.resolve());
const mockRollback = mock(() => Promise.resolve());

mock.module('../improvement-pipeline', () => ({
  improvementPipeline: {
    listFiltered: mockListFiltered,
    getById: mockGetById,
    approve: mockApprove,
    reject: mockReject,
    rollback: mockRollback,
  },
}));

const defaultTierConfig = {
  tier: 'observer',
  autoApply: {
    skillWeights: false,
    memoryThresholds: false,
    modelRouting: false,
    promptOptimization: false,
    newSkills: false,
    workflowGeneration: false,
  },
  guards: { maxDailyAutoChanges: 0, maxCostBudgetUSD: 0 },
};

const mockGetTierConfig = mock(() => Promise.resolve(defaultTierConfig));
const mockSetTier = mock(() => Promise.resolve());

mock.module('../trust-tier.service', () => ({
  trustTierService: {
    getTierConfig: mockGetTierConfig,
    setTier: mockSetTier,
  },
}));

// --- Import after mocking ---

import { OpenAPIHono } from '@hono/zod-openapi';
import { learningRoutes } from '../learning.routes';

// --- Helpers ---

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const WORKSPACE_ID = 'ws-test-123';

function createTestApp() {
  const app = new OpenAPIHono();
  app.use('/*', async (c, next) => {
    c.set('workspaceId', WORKSPACE_ID);
    await next();
  });
  app.route('/learning', learningRoutes());
  return app;
}

const sampleProposal = {
  id: VALID_UUID,
  workspaceId: WORKSPACE_ID,
  pluginId: null,
  proposalType: 'skill_weight',
  changeType: 'behavioral',
  description: 'Lower priority for failing skill',
  evidence: ['high failure rate'],
  beforeValue: { skillId: 'sk-1', priority: 10 },
  afterValue: { skillId: 'sk-1', priority: 5 },
  confidence: 0.8,
  status: 'pending',
  rollbackData: null,
  autoAppliedAt: null,
  approvedAt: null,
  rejectedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

// --- Tests ---

describe('learning.routes', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    app = createTestApp();
    mockListFiltered.mockReset();
    mockGetById.mockReset();
    mockApprove.mockReset();
    mockReject.mockReset();
    mockRollback.mockReset();
    mockGetTierConfig.mockReset();
    mockSetTier.mockReset();

    // Restore defaults after reset
    mockListFiltered.mockImplementation(() => Promise.resolve([]));
    mockGetById.mockImplementation(() => Promise.resolve(null));
    mockApprove.mockImplementation(() => Promise.resolve());
    mockReject.mockImplementation(() => Promise.resolve());
    mockRollback.mockImplementation(() => Promise.resolve());
    mockGetTierConfig.mockImplementation(() => Promise.resolve(defaultTierConfig));
    mockSetTier.mockImplementation(() => Promise.resolve());
  });

  // ----- GET /proposals -----

  describe('GET /learning/proposals', () => {
    it('returns 200 with proposals array from listFiltered', async () => {
      mockListFiltered.mockImplementation(() => Promise.resolve([sampleProposal]));

      const res = await app.request('/learning/proposals');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.proposals).toBeArrayOfSize(1);
      expect(body.proposals[0].id).toBe(VALID_UUID);
    });

    it('passes query params to listFiltered', async () => {
      mockListFiltered.mockImplementation(() => Promise.resolve([]));

      const res = await app.request(
        '/learning/proposals?status=pending&proposalType=skill_weight&since=2026-01-01T00:00:00Z',
      );

      expect(res.status).toBe(200);
      expect(mockListFiltered).toHaveBeenCalledTimes(1);

      const [wsId, filters] = mockListFiltered.mock.calls[0];
      expect(wsId).toBe(WORKSPACE_ID);
      expect(filters.status).toBe('pending');
      expect(filters.proposalType).toBe('skill_weight');
      expect(filters.since).toBeInstanceOf(Date);
    });

    it('returns 500 on service error', async () => {
      mockListFiltered.mockImplementation(() => {
        throw new Error('Database connection lost');
      });

      const res = await app.request('/learning/proposals');

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Database connection lost');
    });
  });

  // ----- GET /proposals/:proposalId -----

  describe('GET /learning/proposals/:proposalId', () => {
    it('returns 200 with proposal when found', async () => {
      mockGetById.mockImplementation(() => Promise.resolve(sampleProposal));

      const res = await app.request(`/learning/proposals/${VALID_UUID}`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(VALID_UUID);
      expect(body.proposalType).toBe('skill_weight');
    });

    it('returns 404 when proposal not found', async () => {
      mockGetById.mockImplementation(() => Promise.resolve(null));

      const res = await app.request(`/learning/proposals/${VALID_UUID}`);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Proposal not found');
    });

    it('validates proposalId is UUID (returns 400 for non-UUID)', async () => {
      const res = await app.request('/learning/proposals/not-a-uuid');

      // zod-openapi param validation failure
      expect(res.status).toBe(400);
    });
  });

  // ----- POST /proposals/:proposalId/approve -----

  describe('POST /learning/proposals/:proposalId/approve', () => {
    it('returns 200 with success true on approve', async () => {
      mockApprove.mockImplementation(() => Promise.resolve());

      const res = await app.request(`/learning/proposals/${VALID_UUID}/approve`, {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockApprove).toHaveBeenCalledWith(VALID_UUID);
    });

    it('returns 404 when proposal not found', async () => {
      mockApprove.mockImplementation(() => {
        throw new Error(`Proposal ${VALID_UUID} not found`);
      });

      const res = await app.request(`/learning/proposals/${VALID_UUID}/approve`, {
        method: 'POST',
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain('not found');
    });

    it('returns 400 on invalid status transition', async () => {
      mockApprove.mockImplementation(() => {
        throw new Error('Cannot approve a rejected proposal');
      });

      const res = await app.request(`/learning/proposals/${VALID_UUID}/approve`, {
        method: 'POST',
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Cannot approve a rejected proposal');
    });
  });

  // ----- POST /proposals/:proposalId/reject -----

  describe('POST /learning/proposals/:proposalId/reject', () => {
    it('returns 200 with success true on reject', async () => {
      mockReject.mockImplementation(() => Promise.resolve());

      const res = await app.request(`/learning/proposals/${VALID_UUID}/reject`, {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockReject).toHaveBeenCalledWith(VALID_UUID);
    });

    it('returns 404 when proposal not found', async () => {
      mockReject.mockImplementation(() => {
        throw new Error(`Proposal ${VALID_UUID} not found`);
      });

      const res = await app.request(`/learning/proposals/${VALID_UUID}/reject`, {
        method: 'POST',
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain('not found');
    });
  });

  // ----- POST /proposals/:proposalId/rollback -----

  describe('POST /learning/proposals/:proposalId/rollback', () => {
    it('returns 200 with success true on rollback', async () => {
      mockRollback.mockImplementation(() => Promise.resolve());

      const res = await app.request(`/learning/proposals/${VALID_UUID}/rollback`, {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockRollback).toHaveBeenCalledWith(VALID_UUID);
    });

    it('returns 400 when proposal cannot be rolled back', async () => {
      mockRollback.mockImplementation(() => {
        throw new Error('Cannot rollback a pending proposal');
      });

      const res = await app.request(`/learning/proposals/${VALID_UUID}/rollback`, {
        method: 'POST',
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Cannot rollback a pending proposal');
    });
  });

  // ----- GET /trust-tier -----

  describe('GET /learning/trust-tier', () => {
    it('returns 200 with tier config', async () => {
      const res = await app.request('/learning/trust-tier');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tier).toBe('observer');
      expect(body.autoApply).toBeDefined();
      expect(body.guards).toBeDefined();
      expect(mockGetTierConfig).toHaveBeenCalledWith(WORKSPACE_ID);
    });
  });

  // ----- PUT /trust-tier -----

  describe('PUT /learning/trust-tier', () => {
    it('returns 200 with updated config after setTier + getTierConfig', async () => {
      const updatedConfig = {
        ...defaultTierConfig,
        tier: 'learner',
        autoApply: { ...defaultTierConfig.autoApply, skillWeights: true },
      };
      mockGetTierConfig.mockImplementation(() => Promise.resolve(updatedConfig));

      const res = await app.request('/learning/trust-tier', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'learner' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tier).toBe('learner');
      expect(mockSetTier).toHaveBeenCalledWith(WORKSPACE_ID, 'learner');
      expect(mockGetTierConfig).toHaveBeenCalledWith(WORKSPACE_ID);
    });

    it('validates body requires valid tier enum', async () => {
      const res = await app.request('/learning/trust-tier', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'invalid_tier' }),
      });

      expect(res.status).toBe(400);
    });
  });
});
