import { Queue } from 'bullmq';
import { redis } from '../../infra/queue/bullmq';
import type { MissionJobData } from '../../modules/missions/missions.types';

const missionQueue = new Queue<MissionJobData>('mission-run', { connection: redis });

export async function enqueueMission(data: MissionJobData): Promise<{ queued: true; missionId: string }> {
  await missionQueue.add('run', data, { attempts: 1, removeOnComplete: 100, removeOnFail: 50 });
  return { queued: true, missionId: data.missionId };
}
