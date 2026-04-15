import type { AgentCategory } from '../agent-profiles/agent-profiles.types';

export type MissionMode = 'assist' | 'interview' | 'advisor' | 'team' | 'autopilot' | 'discipline';
export type MissionStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type MissionWorkerStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type MissionArtifactKind = 'text' | 'json' | 'file' | 'image' | 'code' | 'report';
export type MissionTemplateStatus = 'draft' | 'active' | 'archived';

export interface Mission {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  mode: MissionMode;
  goalPath: Record<string, unknown>;
  budgetCents?: number | null;
  status: MissionTemplateStatus;
  config: Record<string, unknown>;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MissionRun {
  id: string;
  workspaceId: string;
  missionId?: string | null;
  name: string;
  mode: MissionMode;
  status: MissionStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  disciplineMaxRetries: number;
  budgetCents?: number | null;
  spentCents: number;
  costBreakdown: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
}

export interface MissionWorker {
  id: string;
  missionRunId: string;
  role: AgentCategory;
  phase?: string | null;
  status: MissionWorkerStatus;
  agentProfileId?: string | null;
  taskId?: string | null;
  output?: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MissionEvent {
  id: string;
  workspaceId: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  parentResourceId?: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface MissionArtifact {
  id: string;
  missionRunId: string;
  workerId?: string | null;
  kind: MissionArtifactKind;
  title?: string | null;
  content?: string | null;
  contentJson?: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface CreateMissionTemplateInput {
  name: string;
  description?: string;
  mode: MissionMode;
  goalPath?: Record<string, unknown>;
  budgetCents?: number;
  config?: Record<string, unknown>;
  createdBy: string;
}

export interface CreateMissionInput {
  name: string;
  mode: MissionMode;
  input?: Record<string, unknown>;
  disciplineMaxRetries?: number;
  metadata?: Record<string, unknown>;
}

export interface MissionAnalytics {
  period: string;
  totalCostUsd: number;
  runCount: number;
  byProvider: Array<{
    provider: string;
    model: string;
    totalCostUsd: number;
    runCount: number;
  }>;
}

export interface MissionRunCost {
  missionRunId: string;
  totalCostUsd: number;
  breakdown: Array<{
    provider: string;
    model: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    calls: number;
  }>;
}

export interface CreateArtifactInput {
  missionRunId: string;
  workerId?: string;
  kind: MissionArtifactKind;
  title?: string;
  content?: string;
  contentJson?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// ─── Queue types ──────────────────────────────────────────────────────────────

export interface MissionJobData {
  missionId: string;
  workspaceId: string;
}

// ─── Compiler types ───────────────────────────────────────────────────────────

export type MissionPlanKind = 'task' | 'collaboration' | 'orchestration';

export interface WorkerSpec {
  role: AgentCategory;
  phase?: string;
}

export interface MissionPlan {
  kind: MissionPlanKind;
  workers: WorkerSpec[];
}
