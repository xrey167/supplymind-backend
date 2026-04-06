import { createHash } from 'crypto';
import type { RunInput } from './types';

export interface IdempotencyOptions {
  /** Optional job ID to scope the key to a specific BullMQ job/retry */
  jobId?: string;
}

/**
 * Generates a deterministic hex-encoded SHA-256 key for an AI call.
 * Same model + messages + system prompt + jobId → same key.
 * Providers that support idempotency keys (Anthropic beta) use this to
 * deduplicate retried requests and avoid double billing.
 */
export function generateIdempotencyKey(
  input: RunInput,
  opts?: IdempotencyOptions,
): string {
  const digest = {
    model: input.model,
    systemPrompt: input.systemPrompt ?? null,
    messages: input.messages,
    jobId: opts?.jobId ?? null,
  };
  return createHash('sha256')
    .update(JSON.stringify(digest))
    .digest('hex');
}
