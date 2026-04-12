import { describe, it, expect } from 'bun:test';
import {
  workspaceId, taskId, agentId, sessionId, userId, memberId, skillId, jobId, mcpServerId,
  fromDbWorkspaceId, fromDbTaskId, fromDbAgentId, fromDbSessionId,
  WorkspaceId, TaskId
} from '../ids';

describe('Branded IDs', () => {
  it('creates valid workspace ID', () => {
    const id = workspaceId('ws_abc123');
    expect(id as string).toBe('ws_abc123');
    expect(typeof id).toBe('string');
  });

  it('creates valid task ID', () => {
    const id = taskId('task_xyz');
    expect(id as string).toBe('task_xyz');
  });

  it('fromDb variants brand without prefix validation', () => {
    // DB stores raw UUIDs — fromDb trusts them
    const id = fromDbWorkspaceId('550e8400-e29b-41d4-a716-446655440000');
    expect(id as string).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('workspaceId validates prefix', () => {
    expect(() => workspaceId('not_valid')).toThrow();
  });

  it('taskId validates prefix', () => {
    expect(() => taskId('bad_id')).toThrow();
  });

  it('sessionId validates prefix', () => {
    const id = sessionId('sess_001');
    expect(id as string).toBe('sess_001');
  });

  it('all fromDb variants work', () => {
    expect(fromDbTaskId('uuid-1') as string).toBe('uuid-1');
    expect(fromDbAgentId('uuid-2') as string).toBe('uuid-2');
    expect(fromDbSessionId('uuid-3') as string).toBe('uuid-3');
  });
});
