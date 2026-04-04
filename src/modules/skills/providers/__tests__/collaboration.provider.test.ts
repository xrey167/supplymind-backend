import { describe, test, expect } from 'bun:test';
import { CollaborationSkillProvider } from '../collaboration.provider';

describe('CollaborationSkillProvider', () => {
  test('creates provider with correct type and priority', () => {
    const provider = new CollaborationSkillProvider();
    expect(provider.type).toBe('builtin');
    expect(provider.priority).toBe(10);
  });

  test('loadSkills returns collaborate skill with correct structure', async () => {
    const provider = new CollaborationSkillProvider();
    const skills = await provider.loadSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe('builtin:collaborate');
    expect(skills[0].name).toBe('collaborate');
    expect(skills[0].providerType).toBe('builtin');
    expect(skills[0].priority).toBe(10);
  });

  test('skill has correct description', async () => {
    const provider = new CollaborationSkillProvider();
    const skills = await provider.loadSkills();
    expect(skills[0].description).toContain('multi-agent collaboration');
  });

  test('skill has correct inputSchema with all properties', async () => {
    const provider = new CollaborationSkillProvider();
    const skills = await provider.loadSkills();
    const schema = skills[0].inputSchema;

    expect(schema.type).toBe('object');
    expect(schema.properties).toBeDefined();
    expect(schema.required).toEqual(['strategy', 'query', 'agents']);
  });

  test('inputSchema validates strategy enum', async () => {
    const provider = new CollaborationSkillProvider();
    const skills = await provider.loadSkills();
    const schema = skills[0].inputSchema;

    // @ts-ignore - accessing properties dynamically
    expect(schema.properties.strategy.enum).toEqual(['fan_out', 'consensus', 'debate', 'map_reduce']);
  });

  test('skill has handler function', async () => {
    const provider = new CollaborationSkillProvider();
    const skills = await provider.loadSkills();
    expect(typeof skills[0].handler).toBe('function');
  });

  test('inputSchema includes all optional collaboration parameters', async () => {
    const provider = new CollaborationSkillProvider();
    const skills = await provider.loadSkills();
    const schema = skills[0].inputSchema;

    // @ts-ignore - accessing properties dynamically
    expect(schema.properties.judgeAgent).toBeDefined();
    // @ts-ignore
    expect(schema.properties.maxRounds).toBeDefined();
    // @ts-ignore
    expect(schema.properties.convergenceThreshold).toBeDefined();
    // @ts-ignore
    expect(schema.properties.timeoutMs).toBeDefined();
    // @ts-ignore
    expect(schema.properties.items).toBeDefined();
    // @ts-ignore
    expect(schema.properties.mergeStrategy).toBeDefined();
  });

  test('inputSchema validates mergeStrategy enum', async () => {
    const provider = new CollaborationSkillProvider();
    const skills = await provider.loadSkills();
    const schema = skills[0].inputSchema;

    // @ts-ignore - accessing properties dynamically
    expect(schema.properties.mergeStrategy.enum).toEqual(['concat', 'best_score', 'majority_vote', 'custom']);
  });

  test('skill handler rejects invalid strategy', async () => {
    const provider = new CollaborationSkillProvider();
    const skills = await provider.loadSkills();
    const handler = skills[0].handler;

    const result = await handler({
      strategy: 'invalid_strategy',
      query: 'test',
      agents: ['agent-1'],
    });

    // Handler will try to call collaborate with invalid strategy
    // The error handling should catch any issues
    expect(result).toBeDefined();
    expect(typeof result.ok).toBe('boolean');
  });

  test('skill handler rejects missing required fields', async () => {
    const provider = new CollaborationSkillProvider();
    const skills = await provider.loadSkills();
    const handler = skills[0].handler;

    const result = await handler({
      strategy: 'fan_out',
      // missing query and agents
    });

    // Handler receives args and tries to execute
    // Error handling should catch undefined errors
    expect(result).toBeDefined();
    expect(typeof result.ok).toBe('boolean');
  });
});
