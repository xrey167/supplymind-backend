import type { OrchestrationStep } from '../orchestration/orchestration.types';

export type IntentCategory = 'quick' | 'deep' | 'visual' | 'ops';
export type IntentMethod = 'rules' | 'llm';
export type ExecutionPlanStatus = 'draft' | 'pending_approval' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface IntentClassification {
  category: IntentCategory;
  confidence: number;
  method: IntentMethod;
  reasoning?: string;
  cached: boolean;
}

export interface ExecutionStepExtensions {
  riskClass?: 'low' | 'medium' | 'high' | 'critical';
  approvalMode?: 'auto' | 'ask' | 'required';
  pluginId?: string;
  capabilityId?: string;
}

export type ExecutionStep = OrchestrationStep & ExecutionStepExtensions;

export interface ExecutionPolicy {
  maxRetries?: number;
  timeoutMs?: number;
  budgetUsd?: number;
  approvalMode?: 'auto' | 'ask' | 'required';
}

export interface ExecutionPlanRow {
  id: string;
  workspaceId: string;
  name: string | null;
  intent: IntentClassification | null;
  steps: ExecutionStep[];
  input: Record<string, unknown>;
  policy: ExecutionPolicy;
  status: ExecutionPlanStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionRunRow {
  id: string;
  planId: string;
  orchestrationId: string | null;
  workspaceId: string;
  status: string;
  intent: IntentClassification | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface IntentGateConfig {
  enabled: boolean;
  llmFallback: boolean;
  model: string;
  timeoutMs: number;
  riskOverrides: {
    critical: 'block' | 'require_approval' | 'warn';
    high: 'require_approval' | 'warn' | 'allow';
    medium: 'warn' | 'allow';
    low: 'allow';
  };
}

export const DEFAULT_INTENT_GATE_CONFIG: IntentGateConfig = {
  enabled: true,
  llmFallback: true,
  model: 'claude-haiku-4-5-20251001',
  timeoutMs: 2000,
  riskOverrides: {
    critical: 'require_approval',
    high: 'require_approval',
    medium: 'warn',
    low: 'allow',
  },
};
