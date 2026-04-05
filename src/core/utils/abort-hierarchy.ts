/**
 * Hierarchical abort controller with WeakRef-based parent→child propagation.
 *
 * Creates child AbortControllers that automatically abort when their parent does,
 * without preventing garbage collection of abandoned children.
 *
 * Use case: tenant lifecycle → session → request → tool call chain,
 * where aborting the session cancels all in-flight tool calls.
 */

/**
 * Create a child AbortController linked to a parent.
 * When the parent aborts, the child aborts too.
 * If the child is GC'd, the parent listener is a no-op (WeakRef).
 */
export function createChildAbortController(parent: AbortController): AbortController {
  const child = new AbortController();

  // Fast path: parent already aborted
  if (parent.signal.aborted) {
    child.abort(parent.signal.reason);
    return child;
  }

  const weakChild = new WeakRef(child);

  const onParentAbort = () => {
    const c = weakChild.deref();
    if (c && !c.signal.aborted) {
      c.abort(parent.signal.reason);
    }
  };

  parent.signal.addEventListener('abort', onParentAbort, { once: true });

  return child;
}

/**
 * Create a chain of abort controllers: root → ... → leaf.
 * Returns all controllers. Aborting any ancestor aborts all descendants.
 */
export function createAbortChain(depth: number): AbortController[] {
  if (depth < 1) return [];
  const controllers: AbortController[] = [new AbortController()];
  for (let i = 1; i < depth; i++) {
    controllers.push(createChildAbortController(controllers[i - 1]));
  }
  return controllers;
}
