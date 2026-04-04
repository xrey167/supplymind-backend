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
 * Uses AbortSignal.any() for the signals part to avoid manual listener management.
 */
export function combinedAbortSignal(
  signals: AbortSignal[],
  timeoutMs?: number,
): AbortSignal {
  if (timeoutMs === undefined) {
    // Pure signal combination — native AbortSignal.any() avoids listener leaks
    return AbortSignal.any(signals);
  }

  // With timeout: add a manual timer that aborts a controller, then combine via AbortSignal.any
  const timeoutController = new AbortController();
  const timer = setTimeout(
    () => timeoutController.abort(new Error(`Timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );

  const combined = AbortSignal.any([...signals, timeoutController.signal]);

  // Clean up the timer once the combined signal fires (prevents the timer outliving resolution)
  combined.addEventListener(
    'abort',
    () => clearTimeout(timer),
    { once: true },
  );

  return combined;
}
