import { describe, test, expect } from 'bun:test';
import { createCoordinatorConfig, COORDINATOR_SYSTEM_PROMPT, COORDINATOR_ALLOWED_TOOLS } from '../coordinator-config';

describe('createCoordinatorConfig', () => {
  test('returns correct defaults', () => {
    const config = createCoordinatorConfig('ws-123');
    expect(config.workspaceId).toBe('ws-123');
    expect(config.provider).toBe('anthropic');
    expect(config.model).toBe('claude-opus-4-6');
    expect(config.temperature).toBe(0.3);
    expect(config.maxTokens).toBe(8192);
    expect(config.systemPrompt).toBe(COORDINATOR_SYSTEM_PROMPT);
    expect(config.toolIds).toEqual(COORDINATOR_ALLOWED_TOOLS);
    expect(config.id).toBe('coordinator-ws-123');
  });

  test('overrides are applied', () => {
    const config = createCoordinatorConfig('ws-456', { model: 'claude-sonnet-4-6', temperature: 0.1 });
    expect(config.model).toBe('claude-sonnet-4-6');
    expect(config.temperature).toBe(0.1);
    expect(config.workspaceId).toBe('ws-456'); // not overridable via Omit
  });

  test('COORDINATOR_SYSTEM_PROMPT contains key directives', () => {
    expect(COORDINATOR_SYSTEM_PROMPT).toContain('synthesize');
    expect(COORDINATOR_SYSTEM_PROMPT).toContain('delegate');
  });
});
