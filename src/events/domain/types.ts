import { randomUUID } from 'crypto';

/**
 * Base shape for all domain events — generic over event type string and payload.
 * Domain modules extend this; the base layer stays supply-chain-agnostic.
 */
export interface DomainEventEnvelope<TPayload> {
  eventId: string;
  type: string;
  workspaceId: string;
  occurredAt: Date;
  payload: TPayload;
  version: number;
  /** Optional correlation ID for distributed tracing */
  traceId?: string;
}

/** Convenience alias: type-narrowed envelope */
export type DomainEvent<TType extends string, TPayload> = DomainEventEnvelope<TPayload> & {
  type: TType;
};

/**
 * Factory that creates a DomainEvent with a generated eventId and current timestamp.
 */
export function createDomainEvent<TPayload>(
  type: string,
  workspaceId: string,
  payload: TPayload,
  opts?: { traceId?: string; version?: number },
): DomainEventEnvelope<TPayload> {
  return {
    eventId: randomUUID(),
    type,
    workspaceId,
    occurredAt: new Date(),
    payload,
    version: opts?.version ?? 1,
    traceId: opts?.traceId,
  };
}
