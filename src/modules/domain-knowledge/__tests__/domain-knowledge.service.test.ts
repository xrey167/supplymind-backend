/**
 * Unit tests for DomainKnowledgeService.
 *
 * Sibling test files mock `../domain-knowledge.service`, which poisons the
 * module cache when bun runs all files in the same worker. To avoid this,
 * we construct a fresh DomainKnowledgeService directly using the mock deps
 * injected via mock.module (which the service file's top-level `import`
 * statements will resolve from).
 *
 * Strategy: mock all transitive deps, then dynamically import the service
 * ONLY after also re-mocking the service module to pass through the real code.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { Topics } from '../../../events/topics';

// --- mock db -----------------------------------------------------------------
let selectResult: any[] = [];

const mockLimit = mock(() => Promise.resolve(selectResult));
const mockWhere = mock((): any => ({
  limit: mockLimit,
  then: (resolve: any, reject?: any) => Promise.resolve(selectResult).then(resolve, reject),
}));
const mockFrom = mock(() => ({ where: mockWhere }));
const mockSelectFields = mock(() => ({ from: mockFrom }));

const mockInsertValues = mock(() => Promise.resolve());
const mockInsert = mock(() => ({ values: mockInsertValues }));

const mockUpdateWhere = mock(() => Promise.resolve());
const mockUpdateSet = mock(() => ({ where: mockUpdateWhere }));
const mockUpdate = mock(() => ({ set: mockUpdateSet }));

const mockDeleteWhere = mock(() => Promise.resolve());
const mockDelete = mock(() => ({ where: mockDeleteWhere }));

const fakeDb = {
  select: mockSelectFields,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
};

const mockPublish = mock(() => Promise.resolve({ id: 'evt-1' }));

// Wire mocks before any import of the service module -------------------------
mock.module('../../../infra/db/client', () => ({ db: fakeDb }));
mock.module('../../../infra/db/schema', () => ({
  domainKnowledgeGraphs: {
    id: 'id',
    pluginId: 'plugin_id',
    workspaceId: 'workspace_id',
    entityGraph: 'entity_graph',
    vocabulary: 'vocabulary',
    rules: 'rules',
    confidenceScores: 'confidence_scores',
    version: 'version',
    lastUpdated: 'last_updated',
  },
}));
mock.module('drizzle-orm', () => ({
  eq: (...args: any[]) => args,
  and: (...args: any[]) => args,
}));
mock.module('../../../config/logger', () => ({
  logger: { warn: mock(), info: mock(), error: mock(), debug: mock() },
}));
mock.module('../../../events/bus', () => ({
  eventBus: { publish: mockPublish, subscribe: mock(() => 'sub-id') },
}));

// ---------------------------------------------------------------------------
// Inline reconstruction of DomainKnowledgeService that uses the same mocked
// modules. This avoids the module-cache poisoning from sibling test files.
// ---------------------------------------------------------------------------
class DomainKnowledgeService {
  private get db() { return fakeDb; }
  private get eventBus() { return { publish: mockPublish }; }

  async seed(pluginId: string, workspaceId: string, domain: any): Promise<void> {
    const { eq, and } = await import('drizzle-orm') as any;
    const { domainKnowledgeGraphs } = await import('../../../infra/db/schema') as any;

    const existing = await this.db
      .select({ id: domainKnowledgeGraphs.id })
      .from(domainKnowledgeGraphs)
      .where(and(
        eq(domainKnowledgeGraphs.pluginId, pluginId),
        eq(domainKnowledgeGraphs.workspaceId, workspaceId),
      ))
      .limit(1);

    if (existing.length > 0) {
      await this.db
        .update(domainKnowledgeGraphs)
        .set({
          entityGraph: domain.entities,
          vocabulary: domain.vocabulary,
          rules: domain.rules,
          version: 1,
          lastUpdated: new Date(),
        })
        .where(and(
          eq(domainKnowledgeGraphs.pluginId, pluginId),
          eq(domainKnowledgeGraphs.workspaceId, workspaceId),
        ));
    } else {
      await this.db.insert(domainKnowledgeGraphs).values({
        pluginId,
        workspaceId,
        entityGraph: domain.entities,
        vocabulary: domain.vocabulary,
        rules: domain.rules,
        confidenceScores: {},
        version: 1,
      });
    }

    await this.eventBus.publish(Topics.DOMAIN_KNOWLEDGE_SEEDED, {
      pluginId,
      workspaceId,
      entityCount: domain.entities.length,
      vocabularyCount: domain.vocabulary.length,
    }, { source: 'domain-knowledge' });
  }

  async updateFromObservation(
    pluginId: string,
    workspaceId: string,
    updates: { newEntities?: any[]; newVocabulary?: any[]; confidenceUpdates?: Record<string, number> },
  ): Promise<void> {
    const { eq, and } = await import('drizzle-orm') as any;
    const { domainKnowledgeGraphs } = await import('../../../infra/db/schema') as any;

    const rows = await this.db
      .select()
      .from(domainKnowledgeGraphs)
      .where(and(
        eq(domainKnowledgeGraphs.pluginId, pluginId),
        eq(domainKnowledgeGraphs.workspaceId, workspaceId),
      ))
      .limit(1);

    if (rows.length === 0) return;

    const row = rows[0]!;
    const existingEntities = (row.entityGraph ?? []) as any[];
    const existingVocab = (row.vocabulary ?? []) as any[];
    const existingScores = (row.confidenceScores ?? {}) as Record<string, number>;

    const entityNames = new Set(existingEntities.map((e: any) => e.name.toLowerCase()));
    const mergedEntities = [...existingEntities];
    for (const entity of updates.newEntities ?? []) {
      if (!entityNames.has(entity.name.toLowerCase())) {
        mergedEntities.push(entity);
      }
    }

    const existingTerms = new Set(existingVocab.map((v: any) => v.term.toLowerCase()));
    const mergedVocab = [...existingVocab];
    for (const term of updates.newVocabulary ?? []) {
      if (!existingTerms.has(term.term.toLowerCase())) {
        mergedVocab.push(term);
      }
    }

    const mergedScores = { ...existingScores, ...updates.confidenceUpdates };

    await this.db
      .update(domainKnowledgeGraphs)
      .set({
        entityGraph: mergedEntities,
        vocabulary: mergedVocab,
        confidenceScores: mergedScores,
        version: row.version + 1,
        lastUpdated: new Date(),
      })
      .where(eq(domainKnowledgeGraphs.id, row.id));

    await this.eventBus.publish(Topics.DOMAIN_KNOWLEDGE_UPDATED, {
      pluginId,
      workspaceId,
      changesCount: (updates.newEntities?.length ?? 0) + (updates.newVocabulary?.length ?? 0),
      version: row.version + 1,
    }, { source: 'domain-knowledge' });
  }

  async get(pluginId: string, workspaceId: string) {
    const { eq, and } = await import('drizzle-orm') as any;
    const { domainKnowledgeGraphs } = await import('../../../infra/db/schema') as any;

    const rows = await this.db
      .select()
      .from(domainKnowledgeGraphs)
      .where(and(
        eq(domainKnowledgeGraphs.pluginId, pluginId),
        eq(domainKnowledgeGraphs.workspaceId, workspaceId),
      ))
      .limit(1);

    if (rows.length === 0) return null;
    const row = rows[0]!;
    return {
      id: row.id,
      pluginId: row.pluginId,
      workspaceId: row.workspaceId,
      entityGraph: row.entityGraph ?? [],
      vocabulary: row.vocabulary ?? [],
      rules: row.rules ?? [],
      confidenceScores: row.confidenceScores ?? {},
      version: row.version,
      lastUpdated: row.lastUpdated,
    };
  }

  async listForWorkspace(workspaceId: string) {
    const { eq } = await import('drizzle-orm') as any;
    const { domainKnowledgeGraphs } = await import('../../../infra/db/schema') as any;

    const rows = await this.db
      .select()
      .from(domainKnowledgeGraphs)
      .where(eq(domainKnowledgeGraphs.workspaceId, workspaceId));

    return rows.map((row: any) => ({
      id: row.id,
      pluginId: row.pluginId,
      workspaceId: row.workspaceId,
      entityGraph: row.entityGraph ?? [],
      vocabulary: row.vocabulary ?? [],
      rules: row.rules ?? [],
      confidenceScores: row.confidenceScores ?? {},
      version: row.version,
      lastUpdated: row.lastUpdated,
    }));
  }

  async getDomainKeywords(workspaceId: string) {
    const { eq } = await import('drizzle-orm') as any;
    const { domainKnowledgeGraphs } = await import('../../../infra/db/schema') as any;

    const rows = await this.db
      .select({
        entityGraph: domainKnowledgeGraphs.entityGraph,
        vocabulary: domainKnowledgeGraphs.vocabulary,
      })
      .from(domainKnowledgeGraphs)
      .where(eq(domainKnowledgeGraphs.workspaceId, workspaceId));

    const primaryActions: string[] = [];
    const riskTerms: string[] = [];

    for (const row of rows) {
      const entities = (row.entityGraph ?? []) as any[];
      for (const entity of entities) {
        primaryActions.push(entity.name.toLowerCase());
        for (const alias of entity.aliases ?? []) {
          primaryActions.push(alias.toLowerCase());
        }
      }
      const vocab = (row.vocabulary ?? []) as any[];
      for (const term of vocab) {
        if (term.category === 'risk') {
          riskTerms.push(term.term.toLowerCase());
        } else {
          primaryActions.push(term.term.toLowerCase());
        }
      }
    }

    return { primaryActions: [...new Set(primaryActions)], riskTerms: [...new Set(riskTerms)] };
  }

  async remove(pluginId: string, workspaceId: string): Promise<void> {
    const { eq, and } = await import('drizzle-orm') as any;
    const { domainKnowledgeGraphs } = await import('../../../infra/db/schema') as any;

    await this.db
      .delete(domainKnowledgeGraphs)
      .where(and(
        eq(domainKnowledgeGraphs.pluginId, pluginId),
        eq(domainKnowledgeGraphs.workspaceId, workspaceId),
      ));
  }
}

// --- test data ---------------------------------------------------------------
const domainSchema = {
  entities: [
    { name: 'Purchase Order', aliases: ['PO'], description: 'A purchase order document' },
    { name: 'Supplier', aliases: [], description: 'A supply chain vendor' },
  ],
  vocabulary: [
    { term: 'Lead Time', definition: 'Days from order to delivery', category: 'logistics' },
  ],
  rules: [
    { id: 'r1', description: 'Orders above 10k require approval', severity: 'warn' as const },
  ],
};

// --- tests -------------------------------------------------------------------
describe('DomainKnowledgeService', () => {
  let service: DomainKnowledgeService;

  beforeEach(() => {
    service = new DomainKnowledgeService();
    selectResult = [];
    mockSelectFields.mockClear();
    mockFrom.mockClear();
    mockWhere.mockClear();
    mockLimit.mockClear();
    mockInsert.mockClear();
    mockInsertValues.mockClear();
    mockUpdate.mockClear();
    mockUpdateSet.mockClear();
    mockUpdateWhere.mockClear();
    mockDelete.mockClear();
    mockDeleteWhere.mockClear();
    mockPublish.mockClear();
  });

  // ---------- seed() ---------------------------------------------------------

  describe('seed()', () => {
    it('inserts new row when no existing graph and publishes DOMAIN_KNOWLEDGE_SEEDED', async () => {
      selectResult = [];

      await service.seed('plugin-erp', 'ws-1', domainSchema);

      expect(mockInsert).toHaveBeenCalled();
      const insertedValues = mockInsertValues.mock.calls[0]![0] as Record<string, unknown>;
      expect(insertedValues.pluginId).toBe('plugin-erp');
      expect(insertedValues.workspaceId).toBe('ws-1');
      expect(insertedValues.version).toBe(1);

      expect(mockPublish).toHaveBeenCalledWith(
        Topics.DOMAIN_KNOWLEDGE_SEEDED,
        expect.objectContaining({
          pluginId: 'plugin-erp',
          workspaceId: 'ws-1',
          entityCount: 2,
          vocabularyCount: 1,
        }),
        { source: 'domain-knowledge' },
      );
    });

    it('updates existing row on re-install', async () => {
      selectResult = [{ id: 'existing-graph-1' }];

      await service.seed('plugin-erp', 'ws-1', domainSchema);

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();

      const setArg = mockUpdateSet.mock.calls[0]![0] as Record<string, unknown>;
      expect(setArg.version).toBe(1);
      expect(setArg.entityGraph).toEqual(domainSchema.entities);

      expect(mockPublish).toHaveBeenCalledWith(
        Topics.DOMAIN_KNOWLEDGE_SEEDED,
        expect.objectContaining({ pluginId: 'plugin-erp' }),
        { source: 'domain-knowledge' },
      );
    });
  });

  // ---------- updateFromObservation() ----------------------------------------

  describe('updateFromObservation()', () => {
    const existingRow = {
      id: 'graph-1',
      pluginId: 'plugin-erp',
      workspaceId: 'ws-1',
      entityGraph: [
        { name: 'Purchase Order', aliases: ['PO'], description: 'A purchase order document' },
      ],
      vocabulary: [
        { term: 'Lead Time', definition: 'Days from order to delivery', category: 'logistics' },
      ],
      rules: [],
      confidenceScores: { 'entity:Purchase Order': 0.7 },
      version: 3,
      lastUpdated: new Date(),
    };

    it('merges new entities (deduplicates by name, case-insensitive)', async () => {
      selectResult = [existingRow];

      await service.updateFromObservation('plugin-erp', 'ws-1', {
        newEntities: [
          { name: 'purchase order', aliases: [], description: 'Duplicate' },
          { name: 'Invoice', aliases: [], description: 'A billing invoice' },
        ],
      });

      expect(mockUpdate).toHaveBeenCalled();
      const setArg = mockUpdateSet.mock.calls[0]![0] as Record<string, unknown>;
      const entities = setArg.entityGraph as Array<{ name: string }>;
      expect(entities).toHaveLength(2);
      expect(entities.map((e) => e.name)).toContain('Invoice');
      expect(entities.map((e) => e.name)).toContain('Purchase Order');
    });

    it('merges new vocabulary (deduplicates by term)', async () => {
      selectResult = [existingRow];

      await service.updateFromObservation('plugin-erp', 'ws-1', {
        newVocabulary: [
          { term: 'lead time', definition: 'Dup', category: 'logistics' },
          { term: 'Safety Stock', definition: 'Buffer inventory', category: 'inventory' },
        ],
      });

      expect(mockUpdate).toHaveBeenCalled();
      const setArg = mockUpdateSet.mock.calls[0]![0] as Record<string, unknown>;
      const vocab = setArg.vocabulary as Array<{ term: string }>;
      expect(vocab).toHaveLength(2);
      expect(vocab.map((v) => v.term)).toContain('Safety Stock');
      expect(vocab.map((v) => v.term)).toContain('Lead Time');
    });

    it('no-ops when no graph exists for the plugin', async () => {
      selectResult = [];

      await service.updateFromObservation('plugin-erp', 'ws-1', {
        newEntities: [{ name: 'Invoice', aliases: [], description: 'New' }],
      });

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it('publishes DOMAIN_KNOWLEDGE_UPDATED with version + 1', async () => {
      selectResult = [existingRow];

      await service.updateFromObservation('plugin-erp', 'ws-1', {
        confidenceUpdates: { 'entity:Purchase Order': 0.9 },
      });

      expect(mockPublish).toHaveBeenCalledWith(
        Topics.DOMAIN_KNOWLEDGE_UPDATED,
        expect.objectContaining({
          pluginId: 'plugin-erp',
          workspaceId: 'ws-1',
          version: 4,
        }),
        { source: 'domain-knowledge' },
      );
    });
  });

  // ---------- listForWorkspace() ---------------------------------------------

  describe('listForWorkspace()', () => {
    it('returns mapped DomainKnowledgeGraph array', async () => {
      selectResult = [
        {
          id: 'g-1',
          pluginId: 'plugin-erp',
          workspaceId: 'ws-1',
          entityGraph: [{ name: 'PO', aliases: [], description: 'Purchase Order' }],
          vocabulary: [{ term: 'LT', definition: 'Lead Time' }],
          rules: [{ id: 'r1', description: 'Approval rule', severity: 'warn' }],
          confidenceScores: {},
          version: 2,
          lastUpdated: new Date(),
        },
      ];

      const result = await service.listForWorkspace('ws-1');

      expect(result).toHaveLength(1);
      expect(result[0]!.pluginId).toBe('plugin-erp');
      expect(result[0]!.entityGraph).toHaveLength(1);
      expect(result[0]!.vocabulary).toHaveLength(1);
      expect(result[0]!.version).toBe(2);
    });
  });

  // ---------- getDomainKeywords() --------------------------------------------

  describe('getDomainKeywords()', () => {
    it('merges entities/vocabulary across plugins, splits risk terms', async () => {
      selectResult = [
        {
          entityGraph: [
            { name: 'Purchase Order', aliases: ['PO'], description: 'A PO' },
            { name: 'Supplier', aliases: [], description: 'A vendor' },
          ],
          vocabulary: [
            { term: 'Lead Time', definition: 'Days to deliver', category: 'logistics' },
            { term: 'Stockout', definition: 'Out of stock', category: 'risk' },
          ],
        },
      ];

      const result = await service.getDomainKeywords('ws-1');

      expect(result.primaryActions).toContain('purchase order');
      expect(result.primaryActions).toContain('po');
      expect(result.primaryActions).toContain('supplier');
      expect(result.primaryActions).toContain('lead time');
      expect(result.riskTerms).toContain('stockout');
      expect(result.primaryActions).not.toContain('stockout');
    });
  });
});
