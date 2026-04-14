import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { redis } from '../../infra/queue/bullmq';

export interface MissionJobData {
  missionId: string;
  workspaceId: string;
}

export const missionQueue = new Queue<MissionJobData>('mission-run', { connection: redis });

export function enqueueMission(data: MissionJobData): Promise<Job<MissionJobData>> {
  return missionQueue.add('run', data, { attempts: 1, removeOnComplete: 100, removeOnFail: 50 });
}
