import { describe, it, expect } from 'bun:test';
import {
  agentProfiles,
  missionRuns,
  missionWorkers,
  missionArtifacts,
  agentCategoryEnum,
  missionModeEnum,
  missionStatusEnum,
  missionWorkerStatusEnum,
  missionArtifactKindEnum,
  permissionModeEnum,
} from '../missions.schema';

describe('missions schema', () => {
  it('exports agentProfiles table with expected columns', () => {
    expect(agentProfiles.id).toBeDefined();
    expect(agentProfiles.workspaceId).toBeDefined();
    expect(agentProfiles.category).toBeDefined();
    expect(agentProfiles.permissionMode).toBeDefined();
    expect(agentProfiles.isDefault).toBeDefined();
  });

  it('exports missionRuns table with expected columns', () => {
    expect(missionRuns.id).toBeDefined();
    expect(missionRuns.mode).toBeDefined();
    expect(missionRuns.status).toBeDefined();
    expect(missionRuns.input).toBeDefined();
  });

  it('exports missionWorkers table with expected columns', () => {
    expect(missionWorkers.id).toBeDefined();
    expect(missionWorkers.missionRunId).toBeDefined();
    expect(missionWorkers.role).toBeDefined();
    expect(missionWorkers.status).toBeDefined();
  });

  it('exports missionArtifacts table with expected columns', () => {
    expect(missionArtifacts.id).toBeDefined();
    expect(missionArtifacts.missionRunId).toBeDefined();
    expect(missionArtifacts.kind).toBeDefined();
  });

  it('exports all enums', () => {
    expect(agentCategoryEnum).toBeDefined();
    expect(missionModeEnum).toBeDefined();
    expect(missionStatusEnum).toBeDefined();
    expect(missionWorkerStatusEnum).toBeDefined();
    expect(missionArtifactKindEnum).toBeDefined();
    expect(permissionModeEnum).toBeDefined();
  });
});
