import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type { DomainKnowledgeGraph } from '../domain-knowledge.service';

// --- mock domainKnowledgeService ---------------------------------------------
const mockListForWorkspace = mock<() => Promise<DomainKnowledgeGraph[]>>(() => Promise.resolve([]));

const _realDomainKnowledgeService = require('../domain-knowledge.service');
mock.module('../domain-knowledge.service', () => ({
  ..._realDomainKnowledgeService,
  domainKnowledgeService: {
    listForWorkspace: mockListForWorkspace,
  },
}));

// --- mock workspace settings (dynamic import in buildDomainContext) -----------
const mockGetRaw = mock(() => Promise.resolve(500));

const _realWorkspaceSettingsService = require('../../settings/workspace-settings/workspace-settings.service');
mock.module('../../settings/workspace-settings/workspace-settings.service', () => ({
  ..._realWorkspaceSettingsService,
  workspaceSettingsService: { getRaw: mockGetRaw },
}));
// --- mock logger -------------------------------------------------------------
const _realLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({
  ..._realLogger,
  logger: { warn: mock(), info: mock(), error: mock(), debug: mock() },
}));

// --- SUT ---------------------------------------------------------------------
const { buildDomainContext, invalidateDomainContextCache } = await import('../domain-context-injector');

// --- test data ---------------------------------------------------------------
function makeGraph(overrides: Partial<DomainKnowledgeGraph> = {}): DomainKnowledgeGraph {
  return {
    id: 'graph-1',
    pluginId: 'plugin-erp',
    workspaceId: 'ws-1',
    entityGraph: [
      { name: 'Purchase Order', aliases: ['PO'], description: 'A purchase order document' },
      { name: 'Supplier', aliases: ['Vendor'], description: 'A supply chain vendor' },
      { name: 'Invoice', aliases: [], description: 'A billing invoice' },
      { name: 'Warehouse', aliases: ['WH'], description: 'Storage facility' },
      { name: 'Shipment', aliases: [], description: 'Goods in transit' },
      { name: 'Return', aliases: ['RMA'], description: 'Returned merchandise' },
    ],
    vocabulary: [
      { term: 'Lead Time', definition: 'Days from order to delivery', category: 'logistics' },
      { term: 'Safety Stock', definition: 'Buffer inventory', category: 'inventory' },
    ],
    rules: [
      { id: 'r1', description: 'Orders above 10k require approval', severity: 'warn' as const },
      { id: 'r2', description: 'Informational note about process', severity: 'info' as const },
      { id: 'r3', description: 'Cannot exceed budget threshold', severity: 'block' as const },
    ],
    confidenceScores: {},
    version: 1,
    lastUpdated: new Date(),
    ...overrides,
  };
}

// --- tests -------------------------------------------------------------------
describe('domain-context-injector', () => {
  beforeEach(() => {
    mockListForWorkspace.mockClear();
    mockGetRaw.mockClear();
    // Clear all cache entries
    invalidateDomainContextCache('ws-1');
    invalidateDomainContextCache('ws-2');
  });

  describe('buildDomainContext()', () => {
    it('returns formatted string with entities/rules/vocab when graphs exist and prompt matches', async () => {
      const graph = makeGraph();
      mockListForWorkspace.mockResolvedValueOnce([graph]);

      const result = await buildDomainContext('ws-1', 'Check the purchase order and lead time', 500);

      expect(result).toContain('--- Domain Knowledge ---');
      expect(result).toContain('Domain Entities:');
      expect(result).toContain('Purchase Order');
      expect(result).toContain('Business Rules:');
      expect(result).toContain('Domain Vocabulary:');
      expect(result).toContain('Lead Time');
      expect(result).toContain('--- End Domain Knowledge ---');
    });

    it('returns empty string when no graphs for workspace', async () => {
      mockListForWorkspace.mockResolvedValueOnce([]);

      const result = await buildDomainContext('ws-1', 'some prompt', 500);

      expect(result).toBe('');
    });

    it('caches result — second call with same args does not call service again', async () => {
      const graph = makeGraph();
      mockListForWorkspace.mockResolvedValue([graph]);

      // Use a unique workspace to avoid interference
      const ws = 'ws-cache-test';
      const prompt = 'Check purchase order details';
      invalidateDomainContextCache(ws);

      const first = await buildDomainContext(ws, prompt, 500);
      const second = await buildDomainContext(ws, prompt, 500);

      expect(first).toBe(second);
      // listForWorkspace should only have been called once (second call served from cache)
      expect(mockListForWorkspace).toHaveBeenCalledTimes(1);
    });

    it('invalidateDomainContextCache clears entries — next call hits service again', async () => {
      const graph = makeGraph();
      mockListForWorkspace.mockResolvedValue([graph]);

      const ws = 'ws-invalidate-test';
      invalidateDomainContextCache(ws);

      await buildDomainContext(ws, 'purchase order query', 500);
      expect(mockListForWorkspace).toHaveBeenCalledTimes(1);

      invalidateDomainContextCache(ws);

      await buildDomainContext(ws, 'purchase order query', 500);
      expect(mockListForWorkspace).toHaveBeenCalledTimes(2);
    });

    it('scores entities by prompt similarity — top 5 selected', async () => {
      const graph = makeGraph();
      mockListForWorkspace.mockResolvedValueOnce([graph]);

      // Prompt mentions only PO and Supplier — only those should appear
      const result = await buildDomainContext('ws-1', 'The supplier sent a purchase order', 500);

      expect(result).toContain('Purchase Order');
      expect(result).toContain('Supplier');
      // Entities not mentioned in the prompt should not appear (score 0 filtered out)
      expect(result).not.toContain('Warehouse');
      expect(result).not.toContain('Return');
    });

    it('only includes rules with severity !== info', async () => {
      const graph = makeGraph();
      mockListForWorkspace.mockResolvedValueOnce([graph]);

      // Must mention at least one entity for sections to render
      const result = await buildDomainContext('ws-1', 'Check the purchase order', 500);

      expect(result).toContain('[WARN]');
      expect(result).toContain('[BLOCK]');
      // Info rule should be excluded
      expect(result).not.toContain('Informational note about process');
    });
  });
});
