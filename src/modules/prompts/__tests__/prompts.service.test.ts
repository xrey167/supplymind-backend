import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { PromptsService } from '../prompts.service';
import type { PromptsRepository } from '../prompts.repo';
import type { Prompt } from '../prompts.types';

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: 'p-1',
    workspaceId: 'ws-1',
    name: 'test-prompt',
    description: null,
    content: 'Hello {{name}}, welcome to {{org}}!',
    variables: [{ name: 'name' }, { name: 'org' }],
    tags: [],
    version: 1,
    isActive: true,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockRepo(overrides: Partial<PromptsRepository> = {}): PromptsRepository {
  return {
    createPrompt: mock(async (input: any) => makePrompt({
      ...input,
      id: 'p-new',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    findPromptById: mock(async () => null),
    list: mock(async () => []),
    updatePrompt: mock(async (_id: string, input: any) => makePrompt(input)),
    delete: mock(async () => true),
    findByName: mock(async () => null),
    ...overrides,
  } as PromptsRepository;
}

describe('PromptsService', () => {
  describe('extractVariables', () => {
    it('extracts unique variable names from content', () => {
      const svc = new PromptsService(mockRepo());
      const vars = svc.extractVariables('Hello {{name}}, your {{role}} at {{org}}. Hi {{name}}!');
      expect(vars).toEqual([
        { name: 'name' },
        { name: 'role' },
        { name: 'org' },
      ]);
    });

    it('returns empty array when no variables', () => {
      const svc = new PromptsService(mockRepo());
      expect(svc.extractVariables('No variables here')).toEqual([]);
    });
  });

  describe('create', () => {
    it('auto-extracts variables from content', async () => {
      const repo = mockRepo();
      const svc = new PromptsService(repo);

      await svc.create({
        workspaceId: 'ws-1',
        name: 'greeting',
        content: 'Hello {{name}}, welcome to {{org}}!',
      });

      expect(repo.createPrompt).toHaveBeenCalledTimes(1);
      const callArgs = (repo.createPrompt as any).mock.calls[0][0];
      expect(callArgs.variables).toEqual([
        { name: 'name' },
        { name: 'org' },
      ]);
    });

    it('merges explicit variable metadata with extracted', async () => {
      const repo = mockRepo();
      const svc = new PromptsService(repo);

      await svc.create({
        workspaceId: 'ws-1',
        name: 'greeting',
        content: 'Hello {{name}}!',
        variables: [{ name: 'name', description: 'User name', default: 'World' }],
      });

      const callArgs = (repo.createPrompt as any).mock.calls[0][0];
      expect(callArgs.variables).toEqual([
        { name: 'name', description: 'User name', default: 'World' },
      ]);
    });

    it('includes explicit variables not found in content', async () => {
      const repo = mockRepo();
      const svc = new PromptsService(repo);

      await svc.create({
        workspaceId: 'ws-1',
        name: 'test',
        content: 'Hello {{name}}!',
        variables: [
          { name: 'name' },
          { name: 'extra', description: 'Extra var' },
        ],
      });

      const callArgs = (repo.createPrompt as any).mock.calls[0][0];
      expect(callArgs.variables).toHaveLength(2);
      expect(callArgs.variables[1]).toEqual({ name: 'extra', description: 'Extra var' });
    });
  });

  describe('render', () => {
    it('replaces variables with provided values', async () => {
      const prompt = makePrompt({
        content: 'Hello {{name}}, welcome to {{org}}!',
        variables: [{ name: 'name' }, { name: 'org' }],
      });
      const repo = mockRepo({ findPromptById: mock(async () => prompt) });
      const svc = new PromptsService(repo);

      const result = await svc.render('p-1', { name: 'Alice', org: 'Acme' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Hello Alice, welcome to Acme!');
      }
    });

    it('uses defaults for missing variables', async () => {
      const prompt = makePrompt({
        content: 'Hello {{name}}, welcome to {{org}}!',
        variables: [
          { name: 'name', default: 'User' },
          { name: 'org', default: 'SupplyMind' },
        ],
      });
      const repo = mockRepo({ findPromptById: mock(async () => prompt) });
      const svc = new PromptsService(repo);

      const result = await svc.render('p-1', { name: 'Alice' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Hello Alice, welcome to SupplyMind!');
      }
    });

    it('leaves unreplaced variables when no value or default', async () => {
      const prompt = makePrompt({
        content: 'Hello {{name}}!',
        variables: [{ name: 'name' }],
      });
      const repo = mockRepo({ findPromptById: mock(async () => prompt) });
      const svc = new PromptsService(repo);

      const result = await svc.render('p-1', {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Hello {{name}}!');
      }
    });

    it('returns error for non-existent prompt', async () => {
      const repo = mockRepo({ findPromptById: mock(async () => null) });
      const svc = new PromptsService(repo);

      const result = await svc.render('bad-id', {});
      expect(result.ok).toBe(false);
    });
  });

  describe('update — version bump', () => {
    it('creates new version when content changes', async () => {
      const existing = makePrompt({ id: 'p-1', version: 1, content: 'old {{x}}' });
      const repo = mockRepo({
        findPromptById: mock(async () => existing),
        createPrompt: mock(async (input: any) => makePrompt({ ...input, id: 'p-2' })),
        updatePrompt: mock(async (_id: string, input: any) => makePrompt({ ...existing, ...input })),
      });
      const svc = new PromptsService(repo);

      const result = await svc.update('p-1', { content: 'new {{y}}' });
      expect(result.ok).toBe(true);

      // Should have created a new version
      expect(repo.createPrompt).toHaveBeenCalledTimes(1);
      const createArgs = (repo.createPrompt as any).mock.calls[0][0];
      expect(createArgs.version).toBe(2);
      expect(createArgs.content).toBe('new {{y}}');

      // Should have deactivated old version
      expect(repo.updatePrompt).toHaveBeenCalledTimes(1);
      const updateArgs = (repo.updatePrompt as any).mock.calls[0];
      expect(updateArgs[0]).toBe('p-1');
      expect(updateArgs[1]).toEqual({ isActive: false });
    });

    it('updates in-place when content unchanged', async () => {
      const existing = makePrompt({ id: 'p-1', content: 'same' });
      const repo = mockRepo({
        findPromptById: mock(async () => existing),
        updatePrompt: mock(async (_id: string, input: any) => makePrompt({ ...existing, ...input })),
      });
      const svc = new PromptsService(repo);

      const result = await svc.update('p-1', { name: 'renamed' });
      expect(result.ok).toBe(true);

      expect(repo.updatePrompt).toHaveBeenCalledTimes(1);
      expect((repo.createPrompt as any).mock.calls?.length ?? 0).toBe(0);
    });
  });

  describe('get', () => {
    it('returns error for non-existent prompt', async () => {
      const svc = new PromptsService(mockRepo());
      const result = await svc.get('bad-id');
      expect(result.ok).toBe(false);
    });

    it('returns prompt when found', async () => {
      const prompt = makePrompt();
      const repo = mockRepo({ findPromptById: mock(async () => prompt) });
      const svc = new PromptsService(repo);

      const result = await svc.get('p-1');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.id).toBe('p-1');
    });
  });

  describe('delete', () => {
    it('returns error when prompt not found', async () => {
      const repo = mockRepo({ delete: mock(async () => false) });
      const svc = new PromptsService(repo);

      const result = await svc.delete('bad-id');
      expect(result.ok).toBe(false);
    });
  });
});
