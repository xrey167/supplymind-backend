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
