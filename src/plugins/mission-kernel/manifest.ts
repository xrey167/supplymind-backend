import { Worker } from 'bullmq';
import { processMissionJob } from '../../modules/missions/missions.job';
import { logger } from '../../config/logger';
import type { MissionJobData } from '../../modules/missions/missions.types';
import type { PluginManifest } from '../../modules/plugins/plugin-manifest';
import { MissionTopics } from './topics';

export const missionKernelManifest: PluginManifest = {
  id: 'mission-kernel',
  name: 'Mission Kernel',
  version: '1.0.0',
  description: 'Core mission orchestration — runs, workers, artifacts, agent profiles',
  author: 'SupplyMind',
  contributions: {
    topics: { ...MissionTopics },
    onBootstrap: async () => {
      const { registerMissionBudgetTracker } = await import('./budget-tracker');
      const { registerMissionEventPersister } = await import('./mission-event-persister');
      registerMissionBudgetTracker();
      registerMissionEventPersister();
    },
    workers: [
      {
        name: 'mission-kernel:run',
        queueName: 'mission-run',
        factory: (connection) => {
          const w = new Worker<MissionJobData>('mission-run', processMissionJob, {
            connection,
            concurrency: 3,
          });
          w.on('failed', (job: any, err: Error) => {
            logger.error({ jobId: job?.id, missionId: job?.data?.missionId, err }, 'Mission job failed');
          });
          return w;
        },
      },
    ],
    gatewayOps: [
      {
        op: 'mission.create',
        handler: async (req) => {
          const { missionsService } = await import('../../modules/missions/missions.service');
          const { name, mode, input, metadata, disciplineMaxRetries } = req.params as {
            name: string;
            mode: string;
            input?: Record<string, unknown>;
            metadata?: Record<string, unknown>;
            disciplineMaxRetries?: number;
          };
          return missionsService.create(req.context.workspaceId, {
            name,
            mode: mode as import('../../modules/missions/missions.types').MissionMode,
            input,
            metadata,
            disciplineMaxRetries,
          });
        },
      },
      {
        op: 'mission.start',
        handler: async (req) => {
          const { enqueueMission } = await import('./queue');
          const { ok } = await import('../../core/result');
          // Agents fire-and-forget: enqueue the mission and return immediately.
          // The mission-kernel:run BullMQ worker picks it up and calls missionsService.start().
          return ok(await enqueueMission({
            missionId: req.params.id as string,
            workspaceId: req.context.workspaceId,
          }));
        },
      },
      {
        op: 'mission.get',
        handler: async (req) => {
          const { missionsService } = await import('../../modules/missions/missions.service');
          return missionsService.get(req.params.id as string);
        },
      },
      {
        op: 'mission.list',
        handler: async (req) => {
          const { missionsService } = await import('../../modules/missions/missions.service');
          const { ok } = await import('../../core/result');
          // missionsService.list returns a raw array, not a Result — wrap with ok()
          const missions = await missionsService.list(req.context.workspaceId, {
            limit: req.params.limit as number | undefined,
            cursor: req.params.cursor as string | undefined,
          });
          return ok(missions);
        },
      },
      {
        op: 'mission.approve',
        handler: async (req) => {
          const { missionsService } = await import('../../modules/missions/missions.service');
          const { id, approved, comment } = req.params as {
            id: string;
            approved: boolean;
            comment?: string;
          };
          return missionsService.approve(id, approved, comment);
        },
      },
      {
        op: 'mission.input',
        handler: async (req) => {
          const { missionsService } = await import('../../modules/missions/missions.service');
          const { id, input } = req.params as {
            id: string;
            input: Record<string, unknown>;
          };
          return missionsService.input(id, input);
        },
      },
      {
        op: 'mission.cancel',
        handler: async (req) => {
          const { missionsService } = await import('../../modules/missions/missions.service');
          return missionsService.cancel(req.params.id as string);
        },
      },
    ],
  },
};
