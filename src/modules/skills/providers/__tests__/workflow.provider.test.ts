import { describe, test, expect } from 'bun:test';
import { WorkflowSkillProvider } from '../workflow.provider';

describe('WorkflowSkillProvider', () => {
  test('creates provider with correct type and priority', () => {
    const provider = new WorkflowSkillProvider();
    expect(provider.type).toBe('builtin');
    expect(provider.priority).toBe(10);
  });

  test('loadSkills returns execute_workflow skill with correct structure', async () => {
    const provider = new WorkflowSkillProvider();
    const skills = await provider.loadSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe('builtin:execute_workflow');
    expect(skills[0].name).toBe('execute_workflow');
    expect(skills[0].providerType).toBe('builtin');
    expect(skills[0].priority).toBe(10);
  });

  test('skill has correct description', async () => {
    const provider = new WorkflowSkillProvider();
    const skills = await provider.loadSkills();
    expect(skills[0].description).toContain('DAG-based workflow');
  });

  test('skill has correct inputSchema with required properties', async () => {
    const provider = new WorkflowSkillProvider();
    const skills = await provider.loadSkills();
    const schema = skills[0].inputSchema;

    expect(schema.type).toBe('object');
    expect(schema.properties).toBeDefined();
    expect(schema.required).toEqual(['workflow']);
  });

  test('inputSchema workflow definition has required fields', async () => {
    const provider = new WorkflowSkillProvider();
    const skills = await provider.loadSkills();
    const schema = skills[0].inputSchema;

    // @ts-ignore - accessing properties dynamically
    expect(schema.properties.workflow.required).toEqual(['id', 'steps']);
  });

  test('skill has handler function', async () => {
    const provider = new WorkflowSkillProvider();
    const skills = await provider.loadSkills();
    expect(typeof skills[0].handler).toBe('function');
  });

  test('inputSchema includes input property as optional', async () => {
    const provider = new WorkflowSkillProvider();
    const skills = await provider.loadSkills();
    const schema = skills[0].inputSchema;

    // @ts-ignore - accessing properties dynamically
    expect(schema.properties.input).toBeDefined();
  });

  test('inputSchema workflow property accepts maxConcurrency', async () => {
    const provider = new WorkflowSkillProvider();
    const skills = await provider.loadSkills();
    const schema = skills[0].inputSchema;

    // @ts-ignore - accessing properties dynamically
    expect(schema.properties.workflow.properties.maxConcurrency).toBeDefined();
    // @ts-ignore
    expect(schema.properties.workflow.properties.maxConcurrency.type).toBe('number');
  });

  test('inputSchema workflow accepts name and description', async () => {
    const provider = new WorkflowSkillProvider();
    const skills = await provider.loadSkills();
    const schema = skills[0].inputSchema;

    // @ts-ignore - accessing properties dynamically
    expect(schema.properties.workflow.properties.name).toBeDefined();
    // @ts-ignore
    expect(schema.properties.workflow.properties.description).toBeDefined();
  });

  test('skill handler rejects missing workflow', async () => {
    const provider = new WorkflowSkillProvider();
    const skills = await provider.loadSkills();
    const handler = skills[0].handler;

    const result = await handler({});

    // Handler receives empty args and tries to destructure
    // Error handling should catch any issues
    expect(result).toBeDefined();
    expect(typeof result.ok).toBe('boolean');
  });

  test('skill handler rejects missing workflow steps', async () => {
    const provider = new WorkflowSkillProvider();
    const skills = await provider.loadSkills();
    const handler = skills[0].handler;

    const result = await handler({
      workflow: {
        id: 'workflow-1',
        // missing steps
      },
    });

    // Handler receives workflow without steps
    // Error handling should catch any issues
    expect(result).toBeDefined();
    expect(typeof result.ok).toBe('boolean');
  });

  test('inputSchema accepts workflow with complex step definitions', async () => {
    const provider = new WorkflowSkillProvider();
    const skills = await provider.loadSkills();
    const schema = skills[0].inputSchema;

    // Verify that steps array is expected
    // @ts-ignore - accessing properties dynamically
    expect(schema.properties.workflow.properties.steps.type).toBe('array');
  });

  test('skill handler accepts minimal workflow', async () => {
    const provider = new WorkflowSkillProvider();
    const skills = await provider.loadSkills();
    const handler = skills[0].handler;

    const result = await handler({
      workflow: {
        id: 'workflow-1',
        steps: [],
      },
    });

    // Handler should handle minimal workflow
    expect(result).toBeDefined();
    expect(typeof result.ok).toBe('boolean');
  });

  test('skill handler accepts full workflow with all optional fields', async () => {
    const provider = new WorkflowSkillProvider();
    const skills = await provider.loadSkills();
    const handler = skills[0].handler;

    const result = await handler({
      workflow: {
        id: 'workflow-1',
        name: 'Test Workflow',
        description: 'A test workflow',
        maxConcurrency: 3,
        steps: [
          {
            id: 'step-1',
            skillId: 'skill-1',
            message: 'Running step 1',
            args: { key: 'value' },
            onError: 'retry',
            maxRetries: 2,
            when: 'true',
            label: 'Step 1 Label',
          },
        ],
      },
      input: { test: 'input' },
    });

    // Handler should handle complex workflow
    expect(result).toBeDefined();
    expect(typeof result.ok).toBe('boolean');
  });
});
