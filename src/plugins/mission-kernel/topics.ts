/**
 * Mission Kernel event topic constants.
 *
 * These are contributed to the global Topics object at bootstrap via the
 * plugin contribution registry (Step 12.5). Do NOT import from
 * src/events/topics.ts here — that would create a circular dependency through
 * src/core/hooks/hook-registry.ts.
 */

export const MissionTopics = {
  MISSION_CREATED: 'mission.created',
  MISSION_STARTED: 'mission.started',
  MISSION_PAUSED: 'mission.paused',
  MISSION_RESUMED: 'mission.resumed',
  MISSION_COMPLETED: 'mission.completed',
  MISSION_FAILED: 'mission.failed',
  MISSION_CANCELLED: 'mission.cancelled',
  MISSION_WORKER_STARTED: 'mission.worker.started',
  MISSION_WORKER_COMPLETED: 'mission.worker.completed',
  MISSION_WORKER_FAILED: 'mission.worker.failed',
  MISSION_ARTIFACT_CREATED: 'mission.artifact.created',
  MISSION_APPROVAL_REQUIRED: 'mission.approval_required',
  MISSION_INPUT_REQUIRED: 'mission.input_required',
  MISSION_METRICS: 'mission.metrics',
  AGENT_PROFILE_CREATED: 'agent_profile.created',
  AGENT_PROFILE_UPDATED: 'agent_profile.updated',
  AGENT_PROFILE_DELETED: 'agent_profile.deleted',
} as const;

export type MissionTopic = (typeof MissionTopics)[keyof typeof MissionTopics];
