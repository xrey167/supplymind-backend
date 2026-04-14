import type { AgentCategory } from '../agent-profiles/agent-profiles.types';

export type MissionMode = 'assist' | 'interview' | 'advisor' | 'team' | 'autopilot' | 'discipline';
export type MissionStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type MissionWorkerStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type MissionArtifactKind = 'text' | 'json' | 'file' | 'image' | 'code' | 'report';

export interface MissionRun {
  id: string;
  workspaceId: string;
  name: string;
  mode: MissionMode;
  status: MissionStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  disciplineMaxRetries: number;
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
  output?: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
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

export interface CreateMissionInput {
  name: string;
  mode: MissionMode;
  input?: Record<string, unknown>;
  disciplineMaxRetries?: number;
  metadata?: Record<string, unknown>;
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
