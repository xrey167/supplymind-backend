import type { PluginManifest } from '../../modules/plugins/plugin-manifest';
import { MissionTopics } from './topics';
import type { MissionJobData } from './queue';

export const missionKernelManifest: PluginManifest = {
  id: 'mission-kernel',
  name: 'Mission Kernel',
  version: '1.0.0',
  description: 'Core mission orchestration — runs, workers, artifacts, agent profiles',
  author: 'SupplyMind',
  contributions: {
    topics: { ...MissionTopics },
    workers: [
      {
        name: 'mission-kernel:run',
        queueName: 'mission-run',
        factory: (connection) => {
          const { Worker } = require('bullmq');
          const { processMissionJob } = require('../../modules/missions/missions.job');
          const { logger } = require('../../config/logger');
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
          return missionsService.create(req.context.workspaceId, req.params as any);
        },
      },
      {
        op: 'mission.start',
        handler: async (req) => {
          const { missionsService } = await import('../../modules/missions/missions.service');
          return missionsService.start(req.params.id as string);
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
          const missions = await missionsService.list(req.context.workspaceId, {
            limit: req.params.limit as number | undefined,
            cursor: req.params.cursor as string | undefined,
          });
          return ok(missions);
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
