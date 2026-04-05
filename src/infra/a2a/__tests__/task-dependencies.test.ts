import { describe, test, expect } from 'bun:test';

/**
 * Tests the cycle detection algorithm used by TasksService.addDependency().
 * We replicate the BFS logic here to test it in isolation without triggering
 * the full import chain (which pulls in BullMQ and requires Redis).
 */

function wouldCreateCycle(
  taskId: string,
  dependsOnTaskId: string,
  existingEdges: { taskId: string; dependsOnTaskId: string }[],
): boolean {
  const adjList = new Map<string, string[]>();
  for (const edge of existingEdges) {
    const deps = adjList.get(edge.taskId) ?? [];
    deps.push(edge.dependsOnTaskId);
    adjList.set(edge.taskId, deps);
  }
  const proposedDeps = adjList.get(taskId) ?? [];
  proposedDeps.push(dependsOnTaskId);
  adjList.set(taskId, proposedDeps);

  const visited = new Set<string>();
  const queue: string[] = [dependsOnTaskId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dep of adjList.get(current) ?? []) {
      if (!visited.has(dep)) queue.push(dep);
    }
  }
  return false;
}

describe('cycle detection (BFS algorithm from TasksService.addDependency)', () => {
  test('no cycle: adding first edge', () => {
    expect(wouldCreateCycle('A', 'B', [])).toBe(false);
  });

  test('no cycle: extending a chain (A→B, adding B→C)', () => {
    expect(wouldCreateCycle('B', 'C', [
      { taskId: 'A', dependsOnTaskId: 'B' },
    ])).toBe(false);
  });

  test('detects direct cycle (A→B exists, adding B→A)', () => {
    expect(wouldCreateCycle('B', 'A', [
      { taskId: 'A', dependsOnTaskId: 'B' },
    ])).toBe(true);
  });

  test('detects indirect cycle (A→B→C exists, adding C→A)', () => {
    expect(wouldCreateCycle('C', 'A', [
      { taskId: 'A', dependsOnTaskId: 'B' },
      { taskId: 'B', dependsOnTaskId: 'C' },
    ])).toBe(true);
  });

  test('detects self-cycle (A→A)', () => {
    expect(wouldCreateCycle('A', 'A', [])).toBe(true);
  });

  test('no cycle: parallel deps (A→C exists, adding B→C)', () => {
    expect(wouldCreateCycle('B', 'C', [
      { taskId: 'A', dependsOnTaskId: 'C' },
    ])).toBe(false);
  });

  test('no cycle: diamond (A→B, A→C, B→D, adding C→D)', () => {
    expect(wouldCreateCycle('C', 'D', [
      { taskId: 'A', dependsOnTaskId: 'B' },
      { taskId: 'A', dependsOnTaskId: 'C' },
      { taskId: 'B', dependsOnTaskId: 'D' },
    ])).toBe(false);
  });

  test('detects long cycle (A→B→C→D→E, adding E→A)', () => {
    expect(wouldCreateCycle('E', 'A', [
      { taskId: 'A', dependsOnTaskId: 'B' },
      { taskId: 'B', dependsOnTaskId: 'C' },
      { taskId: 'C', dependsOnTaskId: 'D' },
      { taskId: 'D', dependsOnTaskId: 'E' },
    ])).toBe(true);
  });

  test('no cycle in disconnected graph', () => {
    expect(wouldCreateCycle('X', 'Y', [
      { taskId: 'A', dependsOnTaskId: 'B' },
      { taskId: 'C', dependsOnTaskId: 'D' },
    ])).toBe(false);
  });

  test('detects cycle through branching paths', () => {
    // A→B, A→C, B→D, C→D, D→E — adding E→A creates cycle via both branches
    expect(wouldCreateCycle('E', 'A', [
      { taskId: 'A', dependsOnTaskId: 'B' },
      { taskId: 'A', dependsOnTaskId: 'C' },
      { taskId: 'B', dependsOnTaskId: 'D' },
      { taskId: 'C', dependsOnTaskId: 'D' },
      { taskId: 'D', dependsOnTaskId: 'E' },
    ])).toBe(true);
  });
});
