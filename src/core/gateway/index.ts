export { execute } from './gateway';
export { resolveAuth } from './gateway-auth';
export { bridgeTaskEvents } from './gateway-stream';
export { GatewayClient, createGatewayClient } from './gateway-client';
export type {
  GatewayOp,
  GatewayEvent,
  GatewayEventType,
  GatewayContext,
  GatewayRequest,
  GatewayResult,
  OnGatewayEvent,
} from './gateway.types';
export { lifecycleHooks } from '../hooks/hook-registry';
export type { HookEvent, HookHandler, HookRegistration, HookContext, HookResult, HookPayloadMap, TypedHookHandler } from '../hooks/hook-registry';
export type { Brand, TaskId, AgentId, WorkspaceId, SessionId, SkillId, ApprovalId } from '../types/branded-ids';
export { taskId, agentId, workspaceId, sessionId, skillId, approvalId } from '../types/branded-ids';
export { BoundedSet } from '../utils/bounded-set';
export { QueryGuard } from '../utils/query-guard';
export { createChildAbortController, createAbortChain } from '../utils/abort-hierarchy';
export { ScopedConfigStore, scopedConfig } from '../config/scoped-config';
export type { ConfigScope } from '../config/scoped-config';
export { summarizeToolUse } from '../utils/tool-use-summary';
export type { ToolCallRecord, ToolUseSummary } from '../utils/tool-use-summary';
export { pluginManager } from '../../modules/plugins/plugin-manifest';
export type { PluginManifest, PluginSkillDefinition, PluginHookDefinition, PluginConfigDefinition } from '../../modules/plugins/plugin-manifest';
