import { z } from 'zod';

/** Known workspace setting keys and their value schemas */
export const WorkspaceSettingKeys = {
  TOOL_PERMISSION_MODE: 'tool_permission_mode',
  ALLOWED_TOOL_NAMES: 'allowed_tool_names',
  SANDBOX_POLICY: 'sandbox_policy',
  MCP_SERVER_POLICY: 'mcp_server_policy',
  APPROVAL_TIMEOUT_MS: 'approval_timeout_ms',
  BILLING_TIER: 'billing_tier',
  LICENSE_LIMITS: 'license_limits',
  TOKEN_BUDGET: 'token_budget',
  LEARNING_TRUST_TIER: 'learning.trust_tier',
  LEARNING_DOMAIN_CONTEXT_BUDGET: 'learning.domain_context_budget',
  LEARNING_MEMORY_EXTRACTION_THRESHOLD: 'learning.memory_extraction_threshold',
} as const;

export type WorkspaceSettingKey = (typeof WorkspaceSettingKeys)[keyof typeof WorkspaceSettingKeys];

export const toolPermissionModeSchema = z.enum(['auto', 'ask', 'strict']).default('auto');

export const allowedToolNamesSchema = z.array(z.string()).default([]);

export const updateWorkspaceSettingsSchema = z.object({
  toolPermissionMode: z.enum(['auto', 'ask', 'strict']).optional(),
  allowedToolNames: z.array(z.string()).optional(),
});

export const sandboxPolicySchema = z.object({
  maxTimeoutMs: z.number().int().positive().default(30_000),
  allowNetwork: z.boolean().default(false),
  allowedPaths: z.array(z.string()).default([]),
  deniedPaths: z.array(z.string()).default([]),
  maxMemoryMb: z.number().int().positive().default(128),
  lockedByOrg: z.boolean().default(false),
});

export const mcpServerPolicySchema = z.object({
  allowedServerIds: z.array(z.string()).default([]),
  requireApproval: z.boolean().default(false),
});

export const tokenBudgetSchema = z.object({
  monthlyLimitUsd: z.number().positive().optional(),
  warningThreshold: z.number().min(0).max(1).default(0.8),
});

export type TokenBudget = z.infer<typeof tokenBudgetSchema>;
export type ToolPermissionMode = z.infer<typeof toolPermissionModeSchema>;
export type SandboxPolicy = z.infer<typeof sandboxPolicySchema>;
export type McpServerPolicy = z.infer<typeof mcpServerPolicySchema>;
// Learning / AI-native adaptation settings
export const trustTierSchema = z.enum(['observer', 'learner', 'autonomous', 'trusted']).default('observer');
export type TrustTier = z.infer<typeof trustTierSchema>;

export const approvalIdParamSchema = z.object({ approvalId: z.string() });

export type UpdateWorkspaceSettingsInput = z.infer<typeof updateWorkspaceSettingsSchema>;
