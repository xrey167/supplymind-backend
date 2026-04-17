import { AnthropicRawRuntime } from './anthropic';
import { OpenAIRawRuntime } from './openai';
import { GoogleRawRuntime } from './google';
import { AnthropicAgentSdkRuntime } from './anthropic-agent-sdk';
import { OpenAIAgentSdkRuntime } from './openai-agents';
import type { AgentRuntime, AIProvider, AgentMode, RunInput, RunResult, StreamEvent } from './types';
import { withRetry, isRetryable } from '../../core/utils/withRetry';
import { classifyAIError } from '../../core/errors';
import { err } from '../../core/result';
import type { Result } from '../../core/result';
import { captureException } from '../observability/sentry';
import { buildDomainContext, invalidateDomainContextCache } from '../../modules/domain-knowledge/domain-context-injector';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';

export { invalidateDomainContextCache };

export function withRetryRuntime(runtime: AgentRuntime): AgentRuntime {
  return {
    async run(input: RunInput): Promise<Result<RunResult>> {
      return withRetry(
        async () => {
          const result = await runtime.run(input);
          if (!result.ok) throw result.error; // re-throw so withRetry can classify
          return result;
        },
        {
          shouldRetry: (error, _attempt) => {
            // Never retry if the task's AbortSignal is already aborted
            if (input.signal?.aborted) return false;
            return isRetryable(error);
          },
        },
      ).catch((error: unknown) => {
        captureException(error, { provider: 'runtime', signal_aborted: input.signal?.aborted });
        const classified = classifyAIError(error);
        // Preserve original stack by setting cause
        if (error instanceof Error && !(classified instanceof Error && classified.stack?.includes(error.stack ?? ''))) {
          (classified as any).cause = error;
        }
        return err(classified);
      });
    },
    // stream() is NOT wrapped — it has its own watchdog
    stream: runtime.stream.bind(runtime),
  };
}

// Track whether the domain-update invalidation subscription has been registered
let domainContextInvalidationRegistered = false;

/**
 * Wraps a runtime with domain context injection.
 * Enriches `input.systemPrompt` with relevant domain knowledge before calling
 * the inner runtime. Requires `workspaceId` in the input.
 *
 * Cache is invalidated via `invalidateDomainContextCache` on DOMAIN_KNOWLEDGE_UPDATED.
 */
export function withDomainContext(
  runtime: AgentRuntime,
  getWorkspaceId: (input: RunInput) => string | undefined,
): AgentRuntime {
  // Subscribe once — prevents duplicate listeners if withDomainContext is called multiple times,
  // and avoids module-level subscribe which crashes test files that mock events/bus without subscribe
  if (!domainContextInvalidationRegistered) {
    domainContextInvalidationRegistered = true;
    eventBus.subscribe(Topics.DOMAIN_KNOWLEDGE_UPDATED, (event) => {
      const { workspaceId } = event.data as { workspaceId: string };
      if (workspaceId) invalidateDomainContextCache(workspaceId);
    });
  }

  const injectContext = async (input: RunInput): Promise<RunInput> => {
    const workspaceId = getWorkspaceId(input);
    if (!workspaceId) return input;

    const promptText = typeof input.messages.at(-1)?.content === 'string'
      ? (input.messages.at(-1)!.content as string)
      : '';

    const domainContext = await buildDomainContext(workspaceId, promptText);
    if (!domainContext) return input;

    const enrichedSystemPrompt = input.systemPrompt
      ? `${input.systemPrompt}\n\n${domainContext}`
      : domainContext;

    await eventBus.publish(Topics.DOMAIN_CONTEXT_INJECTED, {
      workspaceId,
      tokensAdded: Math.ceil(domainContext.length / 4),
      cacheHit: false, // the injector handles its own cache; this is just an event
    }, { source: 'runtime-factory' });

    return { ...input, systemPrompt: enrichedSystemPrompt };
  };

  return {
    async run(input: RunInput): Promise<Result<RunResult>> {
      return runtime.run(await injectContext(input));
    },
    async *stream(input: RunInput): AsyncIterable<StreamEvent> {
      yield* runtime.stream(await injectContext(input));
    },
  };
}

/**
 * Wraps a runtime to record provider health (success/failure + latency) after each call.
 * Use this on individual provider runtimes before passing to withFallbackRuntime.
 */
export function withHealthTracking(
  runtime: AgentRuntime,
  opts: { workspaceId: string; provider: string },
): AgentRuntime {
  // Lazy import to avoid circular deps and keep test isolation
  const getTrackers = () => import('./circuit-breaker').then((m) => ({
    onSuccess: m.onSuccess,
    onFailure: m.onFailure,
  }));

  return {
    async run(input: RunInput): Promise<Result<RunResult>> {
      const start = Date.now();
      const result = await runtime.run(input);
      const latencyMs = Date.now() - start;
      const { onSuccess, onFailure } = await getTrackers();
      if (result.ok) {
        onSuccess(opts.workspaceId, opts.provider, latencyMs).catch(() => {});
      } else {
        onFailure(opts.workspaceId, opts.provider).catch(() => {});
      }
      return result;
    },
    async *stream(input: RunInput): AsyncIterable<StreamEvent> {
      const start = Date.now();
      let failed = false;
      try {
        yield* runtime.stream(input);
      } catch (e) {
        failed = true;
        throw e;
      } finally {
        const latencyMs = Date.now() - start;
        const { onSuccess, onFailure } = await getTrackers();
        if (failed) {
          onFailure(opts.workspaceId, opts.provider).catch(() => {});
        } else {
          onSuccess(opts.workspaceId, opts.provider, latencyMs).catch(() => {});
        }
      }
    },
  };
}

export function createRuntime(provider: AIProvider, mode: AgentMode, apiKey?: string): AgentRuntime {
  let runtime: AgentRuntime;
  if (mode === 'agent-sdk') {
    if (provider === 'anthropic') runtime = new AnthropicAgentSdkRuntime(apiKey);
    else if (provider === 'openai') runtime = new OpenAIAgentSdkRuntime(apiKey);
    else throw new Error(`No agent-sdk runtime for provider: ${provider}`);
  } else if (provider === 'anthropic') {
    runtime = new AnthropicRawRuntime(apiKey);
  } else if (provider === 'openai') {
    runtime = new OpenAIRawRuntime(apiKey);
  } else if (provider === 'google') {
    runtime = new GoogleRawRuntime(apiKey);
  } else {
    throw new Error(`No raw runtime for provider: ${provider}`);
  }
  return withRetryRuntime(runtime);
}

/**
 * Wraps multiple runtimes in a fallback chain.
 * Tries each runtime in order. Returns the first successful result.
 * If all fail, returns the last error.
 */
export function withFallbackRuntime(runtimes: AgentRuntime[]): AgentRuntime {
  if (runtimes.length === 0) throw new Error('withFallbackRuntime requires at least one runtime');
  return {
    async run(input: RunInput): Promise<Result<RunResult>> {
      let lastResult: Result<RunResult> | undefined;
      for (const runtime of runtimes) {
        lastResult = await runtime.run(input);
        if (lastResult.ok) return lastResult;
      }
      return lastResult!;
    },
    // Stream uses primary only — fallback mid-stream is not feasible with async generators
    async *stream(input: RunInput): AsyncIterable<StreamEvent> {
      yield* runtimes[0].stream(input);
    },
  };
}
