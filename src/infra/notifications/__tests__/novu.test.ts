import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockTrigger = mock((_opts: any) => Promise.resolve({ acknowledged: true }));
mock.module('@novu/api', () => ({
  Novu: class {
    constructor() {}
    trigger = mockTrigger;
  },
}));

process.env.NOVU_API_KEY = 'test-key-123';

const { triggerNotification, getNovuClient, NovuWorkflows } = await import('../novu');

describe('Novu provider', () => {
  beforeEach(() => {
    mockTrigger.mockReset();
    mockTrigger.mockResolvedValue({ acknowledged: true });
  });

  it('returns a client when API key is set', () => {
    const client = getNovuClient();
    expect(client).not.toBeNull();
  });

  it('triggers a notification with correct params', async () => {
    await triggerNotification('agent-failure', 'user-1', { agentId: 'a-1' });
    expect(mockTrigger).toHaveBeenCalledTimes(1);
    const call = mockTrigger.mock.calls[0][0];
    expect(call.workflowId).toBe('agent-failure');
    expect(call.to.subscriberId).toBe('user-1');
    expect(call.payload.agentId).toBe('a-1');
  });

  it('exports workflow ID constants', () => {
    expect(NovuWorkflows.AGENT_FAILURE).toBe('agent-failure');
    expect(NovuWorkflows.TASK_COMPLETED).toBe('task-completed');
  });
});
