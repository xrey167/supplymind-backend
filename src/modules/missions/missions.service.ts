import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { AppError, NotFoundError } from '../../core/errors';
import { eventBus as defaultEventBus } from '../../events/bus';
import { MissionTopics } from '../../plugins/mission-kernel/topics';
import { missionsRepo as defaultRepo } from './missions.repo';
import type { MissionsRepository } from './missions.repo';
import { compileMission } from './missions.compiler';
import type {
  MissionRun, MissionArtifact, CreateMissionInput, CreateArtifactInput,
  MissionAnalytics, MissionRunCost,
} from './missions.types';

type EventBus = Pick<typeof defaultEventBus, 'publish'>;

export class MissionsService {
  private repo: MissionsRepository;
  private bus: EventBus;

  constructor(repo?: MissionsRepository, bus?: EventBus) {
    this.repo = repo ?? defaultRepo;
    this.bus = bus ?? defaultEventBus;
  }

  async create(workspaceId: string, input: CreateMissionInput): Promise<Result<MissionRun>> {
    const mission = await this.repo.createRun(workspaceId, {
      name: input.name,
      mode: input.mode,
      input: input.input ?? {},
      disciplineMaxRetries: input.disciplineMaxRetries ?? 3,
      metadata: input.metadata ?? {},
    });
    this.bus.publish(MissionTopics.MISSION_CREATED, {
      workspaceId,
      missionId: mission.id,
      name: mission.name,
      mode: mission.mode,
      createdAt: mission.createdAt.toISOString(),
    }).catch(() => undefined);
    return ok(mission);
  }

  async get(id: string): Promise<Result<MissionRun>> {
    const mission = await this.repo.findRunById(id);
    if (!mission) return err(new NotFoundError('Mission not found'));
    return ok(mission);
  }

  async list(workspaceId: string, opts?: { limit?: number; cursor?: string }): Promise<MissionRun[]> {
    return this.repo.listRuns(workspaceId, opts);
  }

  async start(id: string): Promise<Result<MissionRun>> {
    const mission = await this.repo.findRunById(id);
    if (!mission) return err(new NotFoundError('Mission not found'));
    if (mission.status !== 'pending') {
      return err(new AppError(`Mission is already ${mission.status}`, 409, 'CONFLICT'));
    }

    const plan = compileMission(mission);
    for (const spec of plan.workers) {
      await this.repo.createWorker({ missionRunId: id, ...spec });
    }

    const updated = await this.repo.updateRunStatus(id, 'running');
    this.bus.publish(MissionTopics.MISSION_STARTED, {
      workspaceId: mission.workspaceId,
      missionId: id,
      startedAt: new Date().toISOString(),
    }).catch(() => undefined);
    return ok(updated!);
  }

  async pause(id: string): Promise<Result<MissionRun>> {
    const mission = await this.repo.findRunById(id);
    if (!mission) return err(new NotFoundError('Mission not found'));
    if (mission.status !== 'running') {
      return err(new AppError('Only running missions can be paused', 409, 'CONFLICT'));
    }

    const updated = await this.repo.updateRunStatus(id, 'paused');
    this.bus.publish(MissionTopics.MISSION_PAUSED, {
      workspaceId: mission.workspaceId,
      missionId: id,
      pausedAt: new Date().toISOString(),
    }).catch(() => undefined);
    return ok(updated!);
  }

  async cancel(id: string): Promise<Result<MissionRun>> {
    const mission = await this.repo.findRunById(id);
    if (!mission) return err(new NotFoundError('Mission not found'));
    if (mission.status === 'completed' || mission.status === 'failed' || mission.status === 'cancelled') {
      return err(new AppError('Mission is already terminal', 409, 'CONFLICT'));
    }

    const updated = await this.repo.updateRunStatus(id, 'cancelled');
    this.bus.publish(MissionTopics.MISSION_CANCELLED, {
      workspaceId: mission.workspaceId,
      missionId: id,
      cancelledAt: new Date().toISOString(),
    }).catch(() => undefined);
    return ok(updated!);
  }

  async approve(id: string, approved: boolean, comment?: string): Promise<Result<MissionRun>> {
    const mission = await this.repo.findRunById(id);
    if (!mission) return err(new NotFoundError('Mission not found'));
    if (mission.status !== 'paused') {
      return err(new AppError('Only paused missions can be approved or rejected', 409, 'CONFLICT'));
    }

    if (approved) {
      const updated = await this.repo.updateRunStatus(id, 'running');
      this.bus.publish(MissionTopics.MISSION_RESUMED, {
        workspaceId: mission.workspaceId,
        missionId: id,
        reason: 'approved',
        comment,
        resumedAt: new Date().toISOString(),
      }).catch(() => undefined);
      return ok(updated!);
    } else {
      const updated = await this.repo.updateRunStatus(id, 'failed');
      this.bus.publish(MissionTopics.MISSION_FAILED, {
        workspaceId: mission.workspaceId,
        missionId: id,
        reason: 'approval_rejected',
        comment,
        failedAt: new Date().toISOString(),
      }).catch(() => undefined);
      return ok(updated!);
    }
  }

  async input(id: string, payload: Record<string, unknown>): Promise<Result<MissionRun>> {
    const mission = await this.repo.findRunById(id);
    if (!mission) return err(new NotFoundError('Mission not found'));
    if (mission.status !== 'paused') {
      return err(new AppError('Only paused missions can receive external input', 409, 'CONFLICT'));
    }

    const updated = await this.repo.updateRunStatus(id, 'running');
    this.bus.publish(MissionTopics.MISSION_RESUMED, {
      workspaceId: mission.workspaceId,
      missionId: id,
      reason: 'input_received',
      input: payload,
      resumedAt: new Date().toISOString(),
    }).catch(() => undefined);
    return ok(updated!);
  }

  async complete(id: string): Promise<Result<MissionRun>> {
    const mission = await this.repo.findRunById(id);
    if (!mission) return err(new NotFoundError('Mission not found'));
    if (mission.status !== 'running') {
      return err(new AppError('Only running missions can be completed', 409, 'CONFLICT'));
    }

    const updated = await this.repo.updateRunStatus(id, 'completed');
    this.bus.publish(MissionTopics.MISSION_COMPLETED, {
      workspaceId: mission.workspaceId,
      missionId: id,
      completedAt: new Date().toISOString(),
    }).catch(() => undefined);
    return ok(updated!);
  }

  async emitArtifact(input: CreateArtifactInput): Promise<Result<MissionArtifact>> {
    const mission = await this.repo.findRunById(input.missionRunId);
    if (!mission) return err(new NotFoundError('Mission not found'));

    const artifact = await this.repo.createArtifact(input);
    this.bus.publish(MissionTopics.MISSION_ARTIFACT_CREATED, {
      workspaceId: mission.workspaceId,
      missionId: mission.id,
      artifactId: artifact.id,
      kind: artifact.kind,
      createdAt: artifact.createdAt.toISOString(),
    }).catch(() => undefined);
    return ok(artifact);
  }

  async getArtifacts(missionRunId: string): Promise<Result<MissionArtifact[]>> {
    const mission = await this.repo.findRunById(missionRunId);
    if (!mission) return err(new NotFoundError('Mission not found'));
    const artifacts = await this.repo.listArtifacts(missionRunId);
    return ok(artifacts);
  }

  async getAnalytics(
    workspaceId: string,
    opts: { period?: string; since?: string; until?: string } = {},
  ): Promise<MissionAnalytics> {
    const period = (opts.period ?? 'month') as 'day' | 'week' | 'month' | 'all';
    const sinceDate = opts.since ? new Date(opts.since) : periodToDate(period);
    const untilDate = opts.until ? new Date(opts.until) : undefined;

    const byProvider = await this.repo.costByProviderAndModel(workspaceId, sinceDate, untilDate);
    const totalCostUsd = byProvider.reduce((sum, r) => sum + r.totalCostUsd, 0);
    const runCount = byProvider.reduce((sum, r) => sum + r.runCount, 0);

    return { period, totalCostUsd, runCount, byProvider };
  }

  async getRunCost(missionRunId: string): Promise<MissionRunCost> {
    return this.repo.costForRun(missionRunId);
  }
}

function periodToDate(period: 'day' | 'week' | 'month' | 'all'): Date {
  const now = new Date();
  if (period === 'day')   return new Date(now.getTime() - 86_400_000);
  if (period === 'week')  return new Date(now.getTime() - 7 * 86_400_000);
  if (period === 'month') return new Date(now.getTime() - 30 * 86_400_000);
  return new Date(0);
}

export const missionsService = new MissionsService();
