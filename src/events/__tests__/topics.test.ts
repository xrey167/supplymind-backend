import { describe, it, expect } from 'bun:test';
import { Topics } from '../topics';

describe('Foundation event topics', () => {
  it('has workspace lifecycle topics', () => {
    expect(Topics.WORKSPACE_CREATED).toBe('workspace.created');
    expect(Topics.WORKSPACE_UPDATED).toBe('workspace.updated');
    expect(Topics.WORKSPACE_DELETING).toBe('workspace.deleting');
    expect(Topics.WORKSPACE_DELETED).toBe('workspace.deleted');
  });

  it('has member lifecycle topics', () => {
    expect(Topics.MEMBER_INVITED).toBe('member.invited');
    expect(Topics.MEMBER_JOINED).toBe('member.joined');
    expect(Topics.MEMBER_REMOVED).toBe('member.removed');
    expect(Topics.MEMBER_ROLE_CHANGED).toBe('member.role_changed');
  });

  it('has user sync topics', () => {
    expect(Topics.USER_SYNCED).toBe('user.synced');
    expect(Topics.USER_DELETED).toBe('user.deleted');
  });

  it('has coordinator phase topics', () => {
    expect(Topics.COORDINATOR_PHASE_CHANGED).toBe('coordinator.phase_changed');
    expect(Topics.COORDINATOR_PHASE_COMPLETED).toBe('coordinator.phase_completed');
  });

  it('has verification verdict topic', () => {
    expect(Topics.VERIFICATION_VERDICT).toBe('verification.verdict');
  });

  it('has tool approval expiry topic', () => {
    expect(Topics.TOOL_APPROVAL_EXPIRED).toBe('tool.approval_expired');
  });
});
