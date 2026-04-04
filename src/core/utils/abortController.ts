/**
 * Creates a child AbortController that aborts when the parent signal aborts.
 * The child aborting independently does NOT abort the parent.
 */
export function createChildAbortController(parent: AbortController): AbortController {
  const child = new AbortController();

  if (parent.signal.aborted) {
    child.abort(parent.signal.reason);
    return child;
  }

  const onParentAbort = () => {
    if (!child.signal.aborted) {
      child.abort(parent.signal.reason);
    }
  };

  parent.signal.addEventListener('abort', onParentAbort, { once: true });

  // When child aborts on its own, remove the parent listener (cleanup)
  child.signal.addEventListener(
    'abort',
    () => parent.signal.removeEventListener('abort', onParentAbort),
    { once: true },
  );

  return child;
}

/**
 * Returns a signal that fires when ANY of the inputs abort, or when the timeout elapses.
 */
export function combinedAbortSignal(
  signals: AbortSignal[],
  timeoutMs?: number,
): AbortSignal {
  const controller = new AbortController();
  const cleanup: Array<() => void> = [];

  const abort = (reason?: unknown) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    for (const fn of cleanup) fn();
  };

  for (const sig of signals) {
    if (sig.aborted) {
      abort(sig.reason);
      return controller.signal;
    }
    const fn = () => abort(sig.reason);
    sig.addEventListener('abort', fn, { once: true });
    cleanup.push(() => sig.removeEventListener('abort', fn));
  }

  if (timeoutMs !== undefined) {
    const timer = setTimeout(
      () => abort(new Error(`Timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    cleanup.push(() => clearTimeout(timer));
  }

  return controller.signal;
}
