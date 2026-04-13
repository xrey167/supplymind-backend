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

// Register once at module initialization — avoids re-subscribing on every withDomainContext call
eventBus.subscribe(Topics.DOMAIN_KNOWLEDGE_UPDATED, (event) => {
  const { workspaceId } = event.data as { workspaceId: string };
  if (workspaceId) invalidateDomainContextCache(workspaceId);
});

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
  // Note: domain cache invalidation subscription is registered at module level above

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

export function createRuntime(provider: AIProvider, mode: AgentMode): AgentRuntime {
  let runtime: AgentRuntime;
  if (mode === 'agent-sdk') {
    if (provider === 'anthropic') runtime = new AnthropicAgentSdkRuntime();
    else if (provider === 'openai') runtime = new OpenAIAgentSdkRuntime();
    else throw new Error(`No agent-sdk runtime for provider: ${provider}`);
  } else if (provider === 'anthropic') {
    runtime = new AnthropicRawRuntime();
  } else if (provider === 'openai') {
    runtime = new OpenAIRawRuntime();
  } else if (provider === 'google') {
    runtime = new GoogleRawRuntime();
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
