import { describe, test, expect } from 'bun:test';
import { toAgentConfig } from '../agents.mapper';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Test Agent',
    provider: 'anthropic',
    mode: 'chat',
    model: 'claude-3-5-haiku-latest',
    systemPrompt: null,
    temperature: null,
    maxTokens: null,
    toolIds: null,
    metadata: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    ...overrides,
  } as Parameters<typeof toAgentConfig>[0];
}

describe('toAgentConfig', () => {
  describe('default values', () => {
    test('should default temperature to 0.7 when null', () => {
      const config = toAgentConfig(makeRow({ temperature: null }));
      expect(config.temperature).toBe(0.7);
    });

    test('should use provided temperature when not null', () => {
      const config = toAgentConfig(makeRow({ temperature: 0.2 }));
      expect(config.temperature).toBe(0.2);
    });

    test('should default maxTokens to 4096 when null', () => {
      const config = toAgentConfig(makeRow({ maxTokens: null }));
      expect(config.maxTokens).toBe(4096);
    });

    test('should use provided maxTokens when not null', () => {
      const config = toAgentConfig(makeRow({ maxTokens: 1024 }));
      expect(config.maxTokens).toBe(1024);
    });

    test('should default toolIds to empty array when null', () => {
      const config = toAgentConfig(makeRow({ toolIds: null }));
      expect(config.toolIds).toEqual([]);
    });

    test('should use provided toolIds when not null', () => {
      const config = toAgentConfig(makeRow({ toolIds: ['tool-a', 'tool-b'] }));
      expect(config.toolIds).toEqual(['tool-a', 'tool-b']);
    });

    test('should default metadata to empty object when null', () => {
      const config = toAgentConfig(makeRow({ metadata: null }));
      expect(config.metadata).toEqual({});
    });

    test('should use provided metadata when not null', () => {
      const meta = { key: 'value' };
      const config = toAgentConfig(makeRow({ metadata: meta }));
      expect(config.metadata).toEqual(meta);
    });

    test('should set systemPrompt to undefined when null', () => {
      const config = toAgentConfig(makeRow({ systemPrompt: null }));
      expect(config.systemPrompt).toBeUndefined();
    });

    test('should use provided systemPrompt when not null', () => {
      const config = toAgentConfig(makeRow({ systemPrompt: 'You are helpful.' }));
      expect(config.systemPrompt).toBe('You are helpful.');
    });
  });

  describe('field mapping', () => {
    test('should map all core fields from row', () => {
      const createdAt = new Date('2024-01-01');
      const updatedAt = new Date('2024-01-02');

      const config = toAgentConfig(
        makeRow({
          id: 'agent-99',
          workspaceId: 'ws-42',
          name: 'Supply Chain Agent',
          provider: 'openai',
          mode: 'task',
          model: 'gpt-4o',
          createdAt,
          updatedAt,
        }),
      );

      expect(config.id).toBe('agent-99');
      expect(config.workspaceId).toBe('ws-42');
      expect(config.name).toBe('Supply Chain Agent');
      expect(config.provider).toBe('openai');
      expect(config.mode).toBe('task');
      expect(config.model).toBe('gpt-4o');
      expect(config.createdAt).toBe(createdAt);
      expect(config.updatedAt).toBe(updatedAt);
    });

    test('should handle all null optional fields simultaneously', () => {
      const config = toAgentConfig(makeRow());

      expect(config.temperature).toBe(0.7);
      expect(config.maxTokens).toBe(4096);
      expect(config.toolIds).toEqual([]);
      expect(config.metadata).toEqual({});
      expect(config.systemPrompt).toBeUndefined();
    });

    test('should handle explicit zero temperature', () => {
      const config = toAgentConfig(makeRow({ temperature: 0 }));
      expect(config.temperature).toBe(0);
    });
  });
});
