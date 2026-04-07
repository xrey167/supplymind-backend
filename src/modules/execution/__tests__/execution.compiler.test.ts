import { describe, it, expect } from 'bun:test';
import { compileToOrchestration } from '../execution.compiler';
import type { ExecutionStep } from '../execution.types';

describe('compileToOrchestration', () => {
  it('strips execution-only fields from steps', () => {
    const steps: ExecutionStep[] = [{ id: 's1', type: 'skill', skillId: 'echo', riskClass: 'high', approvalMode: 'required', pluginId: 'p1', capabilityId: 'c1' }];
    const step = compileToOrchestration(steps).steps[0] as any;
    expect(step.riskClass).toBeUndefined();
    expect(step.approvalMode).toBeUndefined();
    expect(step.pluginId).toBeUndefined();
    expect(step.capabilityId).toBeUndefined();
    expect(step.skillId).toBe('echo');
  });
  it('preserves step dependencies', () => {
    const steps: ExecutionStep[] = [{ id: 's1', type: 'skill', skillId: 'a' }, { id: 's2', type: 'skill', skillId: 'b', dependsOn: ['s1'] }];
    expect(compileToOrchestration(steps).steps[1].dependsOn).toEqual(['s1']);
  });
  it('passes maxConcurrency through', () => {
    expect((compileToOrchestration([], 3) as any).maxConcurrency).toBe(3);
  });
  it('omits maxConcurrency when not provided', () => {
    expect((compileToOrchestration([]) as any).maxConcurrency).toBeUndefined();
  });
});
