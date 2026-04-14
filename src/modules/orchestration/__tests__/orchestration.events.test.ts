import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------
mock.module('../../../config/logger', () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

// ---------------------------------------------------------------------------
// Mock eventBus — capture publish calls
// ---------------------------------------------------------------------------
const mockPublish = mock(async (_topic: string, _data: unknown): Promise<unknown> => undefined);

mock.module('../../../events/bus', () => ({
  eventBus: {
    publish: mockPublish,
  },
}));

// ---------------------------------------------------------------------------
// Import module AFTER mocks are registered
// ---------------------------------------------------------------------------
const {
  emitGateResolved,
  emitGateWaiting,
  emitOrchestrationStarted,
  emitOrchestrationCompleted,
  emitOrchestrationFailed,
  emitOrchestrationCancelled,
  emitStepCompleted,
} = await import('../orchestration.events');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('orchestration.events', () => {
  beforeEach(() => {
    mockPublish.mockReset();
    mockPublish.mockImplementation(async () => undefined);
  });

  describe('emitGateResolved', () => {
    it('publishes to Topics.ORCHESTRATION_GATE_RESOLVED with correct payload (approved)', async () => {
      emitGateResolved('orch-1', 'step-1', 'approved', 'ws-abc');

      // Allow the promise to settle
      await new Promise<void>((r) => setTimeout(r, 0));

      expect(mockPublish).toHaveBeenCalledTimes(1);
      const [topic, data] = mockPublish.mock.calls[0] as [string, unknown];
      expect(topic).toBe('orchestration.gate.resolved');
      expect(data).toEqual({
        orchestrationId: 'orch-1',
        stepId: 'step-1',
        outcome: 'approved',
        workspaceId: 'ws-abc',
      });
    });

    it('publishes to Topics.ORCHESTRATION_GATE_RESOLVED with outcome: rejected', async () => {
      emitGateResolved('orch-2', 'step-2', 'rejected', 'ws-xyz');

      await new Promise<void>((r) => setTimeout(r, 0));

      expect(mockPublish).toHaveBeenCalledTimes(1);
      const [topic, data] = mockPublish.mock.calls[0] as [string, unknown];
      expect(topic).toBe('orchestration.gate.resolved');
      expect((data as Record<string, unknown>).outcome).toBe('rejected');
    });

    it('publishes to Topics.ORCHESTRATION_GATE_RESOLVED with outcome: timeout', async () => {
      emitGateResolved('orch-3', 'step-3', 'timeout', 'ws-def');

      await new Promise<void>((r) => setTimeout(r, 0));

      expect(mockPublish).toHaveBeenCalledTimes(1);
      const [topic, data] = mockPublish.mock.calls[0] as [string, unknown];
      expect(topic).toBe('orchestration.gate.resolved');
      expect((data as Record<string, unknown>).outcome).toBe('timeout');
      expect((data as Record<string, unknown>).orchestrationId).toBe('orch-3');
      expect((data as Record<string, unknown>).workspaceId).toBe('ws-def');
    });

    it('swallows publish errors without throwing', async () => {
      mockPublish.mockImplementationOnce(async () => { throw new Error('bus down'); });

      // Should not throw
      expect(() => emitGateResolved('orch-err', 'step-1', 'approved', 'ws-1')).not.toThrow();
      // Allow the rejection to be caught
      await new Promise<void>((r) => setTimeout(r, 10));
    });
  });

  describe('emitGateWaiting', () => {
    it('publishes to orchestration.gate.waiting', async () => {
      emitGateWaiting('orch-w', 'step-w', 'Please approve', 'ws-w');
      await new Promise<void>((r) => setTimeout(r, 0));

      expect(mockPublish).toHaveBeenCalledTimes(1);
      const [topic] = mockPublish.mock.calls[0] as [string, unknown];
      expect(topic).toBe('orchestration.gate.waiting');
    });
  });

  describe('other emit helpers', () => {
    it('emitOrchestrationStarted publishes orchestration.started', async () => {
      emitOrchestrationStarted('orch-s', 'ws-s');
      await new Promise<void>((r) => setTimeout(r, 0));
      const [topic] = mockPublish.mock.calls[0] as [string, unknown];
      expect(topic).toBe('orchestration.started');
    });

    it('emitOrchestrationCompleted publishes orchestration.completed', async () => {
      emitOrchestrationCompleted('orch-c', 'ws-c');
      await new Promise<void>((r) => setTimeout(r, 0));
      const [topic] = mockPublish.mock.calls[0] as [string, unknown];
      expect(topic).toBe('orchestration.completed');
    });

    it('emitOrchestrationFailed publishes orchestration.failed', async () => {
      emitOrchestrationFailed('orch-f', 'ws-f', 'boom');
      await new Promise<void>((r) => setTimeout(r, 0));
      const [topic] = mockPublish.mock.calls[0] as [string, unknown];
      expect(topic).toBe('orchestration.failed');
    });

    it('emitOrchestrationCancelled publishes orchestration.cancelled', async () => {
      emitOrchestrationCancelled('orch-x', 'ws-x');
      await new Promise<void>((r) => setTimeout(r, 0));
      const [topic] = mockPublish.mock.calls[0] as [string, unknown];
      expect(topic).toBe('orchestration.cancelled');
    });

    it('emitStepCompleted publishes orchestration.step.completed', async () => {
      emitStepCompleted('orch-st', 'step-st', 'completed', 'ws-st');
      await new Promise<void>((r) => setTimeout(r, 0));
      const [topic] = mockPublish.mock.calls[0] as [string, unknown];
      expect(topic).toBe('orchestration.step.completed');
    });
  });
});
