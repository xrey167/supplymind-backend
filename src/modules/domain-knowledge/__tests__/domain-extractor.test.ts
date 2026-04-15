import { describe, it, expect, beforeEach, mock, afterAll } from 'bun:test';
import { Topics } from '../../../events/topics';
import type { BusEvent } from '../../../events/bus';
import type { DomainKnowledgeGraph } from '../domain-knowledge.service';

// --- mock domainKnowledgeService ---------------------------------------------
const mockListForWorkspace = mock<() => Promise<DomainKnowledgeGraph[]>>(() => Promise.resolve([]));
const mockUpdateFromObservation = mock(() => Promise.resolve());

mock.module('../domain-knowledge.service', () => ({
  domainKnowledgeService: {
    listForWorkspace: mockListForWorkspace,
    updateFromObservation: mockUpdateFromObservation,
  },
}));

const _realLogger = require('../../../config/logger');
mock.module('../../../config/logger', () => ({
  ..._realLogger,
  logger: { warn: mock(), info: mock(), error: mock(), debug: mock() },
}));

// --- SUT ---------------------------------------------------------------------
const { initDomainExtractionHandler, _resetDomainExtractionHandler } = await import('../domain-extractor');

// --- test data ---------------------------------------------------------------
const taskRow = {
  id: 'task-1',
  workspaceId: 'ws-1',
  history: [
    { role: 'user', parts: [{ kind: 'text', text: 'Check the purchase order for Acme Corp' }] },
    { role: 'assistant', parts: [{ kind: 'text', text: 'I found the purchase order from Acme Corp' }] },
  ],
};

function makeDomainGraph(overrides: Partial<DomainKnowledgeGraph> = {}): DomainKnowledgeGraph {
  return {
    id: 'graph-1',
    pluginId: 'plugin-erp',
    workspaceId: 'ws-1',
    entityGraph: [
      { name: 'Acme Corp', aliases: ['Acme'], description: 'A key supplier' },
      { name: 'Purchase Order', aliases: ['PO'], description: 'A purchase order document' },
    ],
    vocabulary: [
      { term: 'Lead Time', definition: 'Days from order to delivery', category: 'logistics' },
    ],
    rules: [],
    confidenceScores: { 'entity:Acme Corp': 0.5 },
    version: 2,
    lastUpdated: new Date(),
    ...overrides,
  };
}

function makeEvent(taskId: string): BusEvent {
  return {
    id: 'evt-1',
    topic: Topics.TASK_COMPLETED,
    data: { taskId },
    source: 'test',
    timestamp: new Date().toISOString(),
  };
}

// --- tests -------------------------------------------------------------------
describe('domain-extractor', () => {
  let capturedHandler: ((event: BusEvent) => Promise<void>) | undefined;
  let mockRepo: { findRawById: ReturnType<typeof mock> };
  let mockBus: { subscribe: ReturnType<typeof mock> };

  beforeEach(() => {
    _resetDomainExtractionHandler();
    mockListForWorkspace.mockClear();
    mockUpdateFromObservation.mockClear();
    capturedHandler = undefined;

    mockRepo = {
      findRawById: mock(() => Promise.resolve(taskRow)),
    };
    mockBus = {
      subscribe: mock((topic: string, handler: (event: BusEvent) => Promise<void>) => {
        if (topic === Topics.TASK_COMPLETED) {
          capturedHandler = handler;
        }
        return 'sub-id';
      }),
    };

    initDomainExtractionHandler(mockBus as any, mockRepo as any);
  });

  it('TASK_COMPLETED with entity mentions calls updateFromObservation with confidence boosts', async () => {
    const graph = makeDomainGraph();
    mockListForWorkspace.mockResolvedValueOnce([graph]);

    expect(capturedHandler).toBeDefined();
    await capturedHandler!(makeEvent('task-1'));

    expect(mockUpdateFromObservation).toHaveBeenCalledTimes(1);

    const [pluginId, workspaceId, updates] = mockUpdateFromObservation.mock.calls[0]! as [
      string,
      string,
      { confidenceUpdates: Record<string, number> },
    ];
    expect(pluginId).toBe('plugin-erp');
    expect(workspaceId).toBe('ws-1');
    // Acme Corp is mentioned -> confidence boost
    expect(updates.confidenceUpdates['entity:Acme Corp']).toBeGreaterThan(0.5);
    // Purchase Order is mentioned -> confidence boost
    expect(updates.confidenceUpdates['entity:Purchase Order']).toBeDefined();
  });

  it('no graphs for workspace -> no updateFromObservation call', async () => {
    mockListForWorkspace.mockResolvedValueOnce([]);

    await capturedHandler!(makeEvent('task-1'));

    expect(mockUpdateFromObservation).not.toHaveBeenCalled();
  });

  it('no matching entities in transcript -> no updateFromObservation call', async () => {
    const graph = makeDomainGraph({
      entityGraph: [
        { name: 'Contoso Ltd', aliases: [], description: 'A different company' },
      ],
      vocabulary: [
        { term: 'Reorder Point', definition: 'Minimum stock trigger', category: 'inventory' },
      ],
    });
    mockListForWorkspace.mockResolvedValueOnce([graph]);

    await capturedHandler!(makeEvent('task-1'));

    // None of the entity names or vocab terms appear in the transcript
    expect(mockUpdateFromObservation).not.toHaveBeenCalled();
  });

  it('task not found -> no-op', async () => {
    mockRepo.findRawById.mockResolvedValueOnce(null);

    await capturedHandler!(makeEvent('task-missing'));

    expect(mockListForWorkspace).not.toHaveBeenCalled();
    expect(mockUpdateFromObservation).not.toHaveBeenCalled();
  });

  it('empty history -> no-op', async () => {
    mockRepo.findRawById.mockResolvedValueOnce({
      id: 'task-1',
      workspaceId: 'ws-1',
      history: [],
    });

    await capturedHandler!(makeEvent('task-1'));

    expect(mockListForWorkspace).not.toHaveBeenCalled();
    expect(mockUpdateFromObservation).not.toHaveBeenCalled();
  });
});

afterAll(() => mock.restore());
