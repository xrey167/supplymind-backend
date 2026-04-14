import { z } from 'zod/v4';

/**
 * Supply chain event payload schemas — re-exported from the supply-chain plugin.
 *
 * The canonical definitions live in src/plugins/supply-chain/events.ts.
 * This file exists for backward compatibility with existing imports.
 */
export * from '../../plugins/supply-chain/events';

// ---------------------------------------------------------------------------
// Mission events — will move to src/plugins/mission-kernel/events.ts
// ---------------------------------------------------------------------------

const missionId = z.string().uuid();
const workerId = z.string().uuid();
const workspaceId = z.string().uuid();
const isoTimestamp = z.string().datetime({ offset: true }).optional();

export const MissionCreatedPayload = z.object({
  workspaceId,
  missionId,
  name: z.string(),
  mode: z.string(),
  createdAt: isoTimestamp,
});
export type MissionCreatedPayload = z.infer<typeof MissionCreatedPayload>;

export const MissionStartedPayload = z.object({
  workspaceId,
  missionId,
  startedAt: isoTimestamp,
});
export type MissionStartedPayload = z.infer<typeof MissionStartedPayload>;

export const MissionPausedPayload = z.object({
  workspaceId,
  missionId,
  pausedAt: isoTimestamp,
});
export type MissionPausedPayload = z.infer<typeof MissionPausedPayload>;

export const MissionResumedPayload = z.object({
  workspaceId,
  missionId,
  resumedAt: isoTimestamp,
});
export type MissionResumedPayload = z.infer<typeof MissionResumedPayload>;

export const MissionCompletedPayload = z.object({
  workspaceId,
  missionId,
  completedAt: isoTimestamp,
});
export type MissionCompletedPayload = z.infer<typeof MissionCompletedPayload>;

export const MissionFailedPayload = z.object({
  workspaceId,
  missionId,
  error: z.string().optional(),
  failedAt: isoTimestamp,
});
export type MissionFailedPayload = z.infer<typeof MissionFailedPayload>;

export const MissionCancelledPayload = z.object({
  workspaceId,
  missionId,
  cancelledAt: isoTimestamp,
});
export type MissionCancelledPayload = z.infer<typeof MissionCancelledPayload>;

export const MissionWorkerStartedPayload = z.object({
  workspaceId,
  missionId,
  workerId,
  role: z.string(),
  startedAt: isoTimestamp,
});
export type MissionWorkerStartedPayload = z.infer<typeof MissionWorkerStartedPayload>;

export const MissionWorkerCompletedPayload = z.object({
  workspaceId,
  missionId,
  workerId,
  completedAt: isoTimestamp,
});
export type MissionWorkerCompletedPayload = z.infer<typeof MissionWorkerCompletedPayload>;

export const MissionWorkerFailedPayload = z.object({
  workspaceId,
  missionId,
  workerId,
  error: z.string().optional(),
  failedAt: isoTimestamp,
});
export type MissionWorkerFailedPayload = z.infer<typeof MissionWorkerFailedPayload>;

export const MissionArtifactCreatedPayload = z.object({
  workspaceId,
  missionId,
  artifactId: z.string().uuid(),
  kind: z.string(),
  createdAt: isoTimestamp,
});
export type MissionArtifactCreatedPayload = z.infer<typeof MissionArtifactCreatedPayload>;

export const MissionApprovalRequiredPayload = z.object({
  workspaceId,
  missionId,
  workerId: workerId.optional(),
  prompt: z.string(),
  requestedAt: isoTimestamp,
});
export type MissionApprovalRequiredPayload = z.infer<typeof MissionApprovalRequiredPayload>;

export const MissionInputRequiredPayload = z.object({
  workspaceId,
  missionId,
  workerId: workerId.optional(),
  prompt: z.string(),
  requestedAt: isoTimestamp,
});
export type MissionInputRequiredPayload = z.infer<typeof MissionInputRequiredPayload>;

export const MissionMetricsPayload = z.object({
  workspaceId,
  missionId,
  tokensUsed: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
  workersCompleted: z.number().nonnegative().optional(),
  recordedAt: isoTimestamp,
});
export type MissionMetricsPayload = z.infer<typeof MissionMetricsPayload>;

// ---------------------------------------------------------------------------
// Agent Profile events — will move to src/plugins/mission-kernel/events.ts
// ---------------------------------------------------------------------------

const agentProfileId = z.string().uuid();

export const AgentProfileCreatedPayload = z.object({
  workspaceId,
  profileId: agentProfileId,
  category: z.string(),
  createdAt: isoTimestamp,
});
export type AgentProfileCreatedPayload = z.infer<typeof AgentProfileCreatedPayload>;

export const AgentProfileUpdatedPayload = z.object({
  workspaceId,
  profileId: agentProfileId,
  updatedAt: isoTimestamp,
});
export type AgentProfileUpdatedPayload = z.infer<typeof AgentProfileUpdatedPayload>;

export const AgentProfileDeletedPayload = z.object({
  workspaceId,
  profileId: agentProfileId,
  deletedAt: isoTimestamp,
});
export type AgentProfileDeletedPayload = z.infer<typeof AgentProfileDeletedPayload>;
