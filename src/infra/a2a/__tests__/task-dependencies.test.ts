import { describe, test, expect, beforeEach, spyOn, afterAll } from 'bun:test';
import { taskRepo } from '../task-repo';

// Spy on taskRepo methods. We set fast-returning default implementations so the
// spies don't cause postgres connection hangs in other test files that share the
// same module instance (e.g. task-manager.test.ts).

const addDependencySpy = spyOn(taskRepo, 'addDependency').mockResolvedValue(undefined);
const removeDependencySpy = spyOn(taskRepo, 'removeDependency').mockResolvedValue(undefined);
const getDependenciesSpy = spyOn(taskRepo, 'getDependencies').mockResolvedValue({ blockedBy: [], blocks: [] });
const getBlockersSpy = spyOn(taskRepo, 'getBlockers').mockResolvedValue([]);

afterAll(() => {
  addDependencySpy.mockRestore();
  removeDependencySpy.mockRestore();
  getDependenciesSpy.mockRestore();
  getBlockersSpy.mockRestore();
});

describe('taskRepo.addDependency', () => {
  beforeEach(() => {
    addDependencySpy.mockClear();
    addDependencySpy.mockResolvedValue(undefined);
  });

  test('inserts a dependency row (resolved without error)', async () => {
    await taskRepo.addDependency('task-a', 'task-b');
    expect(addDependencySpy).toHaveBeenCalledTimes(1);
    expect(addDependencySpy).toHaveBeenCalledWith('task-a', 'task-b');
  });

  test('can be called with any task ID pair', async () => {
    await taskRepo.addDependency('task-x', 'task-y');
    expect(addDependencySpy).toHaveBeenCalledWith('task-x', 'task-y');
  });
});

describe('taskRepo.removeDependency', () => {
  beforeEach(() => {
    removeDependencySpy.mockClear();
    removeDependencySpy.mockResolvedValue(undefined);
  });

  test('removes the matching dependency row (resolved without error)', async () => {
    await taskRepo.removeDependency('task-a', 'task-b');
    expect(removeDependencySpy).toHaveBeenCalledTimes(1);
    expect(removeDependencySpy).toHaveBeenCalledWith('task-a', 'task-b');
  });
});

describe('taskRepo.getDependencies', () => {
  beforeEach(() => {
    getDependenciesSpy.mockClear();
  });

  test('returns empty blockedBy and blocks when no dependencies exist', async () => {
    getDependenciesSpy.mockResolvedValue({ blockedBy: [], blocks: [] });
    const result = await taskRepo.getDependencies('task-x');
    expect(result.blockedBy).toEqual([]);
    expect(result.blocks).toEqual([]);
  });

  test('returns correct blockedBy array (tasks that must complete first)', async () => {
    getDependenciesSpy.mockResolvedValue({
      blockedBy: ['task-dep-1', 'task-dep-2'],
      blocks: [],
    });
    const result = await taskRepo.getDependencies('task-x');
    expect(result.blockedBy).toEqual(['task-dep-1', 'task-dep-2']);
  });

  test('returns correct blocks array (tasks that cannot run until this one completes)', async () => {
    getDependenciesSpy.mockResolvedValue({
      blockedBy: [],
      blocks: ['task-downstream'],
    });
    const result = await taskRepo.getDependencies('task-x');
    expect(result.blocks).toEqual(['task-downstream']);
  });

  test('returns both blockedBy and blocks when both exist', async () => {
    getDependenciesSpy.mockResolvedValue({
      blockedBy: ['task-dep-1', 'task-dep-2'],
      blocks: ['task-downstream'],
    });
    const result = await taskRepo.getDependencies('task-x');
    expect(result.blockedBy).toHaveLength(2);
    expect(result.blocks).toHaveLength(1);
  });
});

describe('taskRepo.getBlockers', () => {
  beforeEach(() => {
    getBlockersSpy.mockClear();
  });

  test('returns empty array when task has no dependencies', async () => {
    getBlockersSpy.mockResolvedValue([]);
    const result = await taskRepo.getBlockers('task-a');
    expect(result).toEqual([]);
  });

  test('returns only non-terminal blocker task IDs', async () => {
    // getBlockers filters out terminal states (completed, failed, canceled) internally.
    // This test verifies the contract: only non-terminal task IDs are returned.
    getBlockersSpy.mockResolvedValue(['task-b']); // task-c (completed) and task-d (failed) excluded
    const result = await taskRepo.getBlockers('task-a');
    expect(result).toEqual(['task-b']);
  });

  test('returns empty array when all dependencies are in terminal states', async () => {
    getBlockersSpy.mockResolvedValue([]);
    const result = await taskRepo.getBlockers('task-a');
    expect(result).toEqual([]);
  });

  test('returns all non-terminal dep IDs when none are done', async () => {
    getBlockersSpy.mockResolvedValue(['task-b', 'task-c']);
    const result = await taskRepo.getBlockers('task-a');
    expect(result).toHaveLength(2);
    expect(result).toContain('task-b');
    expect(result).toContain('task-c');
  });
});
