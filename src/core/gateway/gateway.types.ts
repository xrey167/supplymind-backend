import type { Role } from '../security';
import type { Result } from '../result';

// ---------------------------------------------------------------------------
// Operations — every capability the platform exposes, regardless of transport
// ---------------------------------------------------------------------------

export type GatewayOp =
  | 'skill.invoke'
  | 'skill.list'
  | 'task.send'
  | 'task.get'
  | 'task.cancel'
  | 'task.list'
  | 'agent.invoke'
  | 'agent.list'
  | 'session.create'
  | 'session.resume'
  | 'session.addMessage'
  | 'memory.approve'
  | 'memory.reject'
  | 'orchestration.start'
  | 'orchestration.gate.respond'
  | 'collaboration.start';

// ---------------------------------------------------------------------------
// Streaming events — protocol-agnostic, each transport adapter projects these
// ---------------------------------------------------------------------------

export type GatewayEventType =
  | 'text_delta'
  | 'thinking_delta'
  | 'tool_call'
  | 'status'
  | 'artifact'
  | 'round_completed'
  | 'error'
  | 'approval_required'
  | 'done';

export interface GatewayEvent {
  type: GatewayEventType;
  data: unknown;
}

export type OnGatewayEvent = (event: GatewayEvent) => void;

// ---------------------------------------------------------------------------
// Context — built by each protocol adapter from its auth mechanism
// ---------------------------------------------------------------------------

export interface GatewayContext {
  callerId: string;
  workspaceId: string;
  callerRole: Role;
  traceId?: string;
  signal?: AbortSignal;
  sessionId?: string;
  /** Streaming callback. If provided, the gateway pipes task events here. */
  onEvent?: OnGatewayEvent;
}

// ---------------------------------------------------------------------------
// Request / Response
// ---------------------------------------------------------------------------

export interface GatewayRequest {
  op: GatewayOp;
  params: Record<string, unknown>;
  context: GatewayContext;
}

export type GatewayResult = Result<unknown>;
