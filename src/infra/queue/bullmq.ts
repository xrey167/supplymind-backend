import { Queue, QueueEvents, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';

const REDIS_URL = Bun.env.REDIS_URL ?? 'redis://localhost:6379';

// Shared Redis connection for BullMQ
const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

export { connection as redis };

// Skill execution queue
export const skillQueue = new Queue('skill-execution', { connection });

// Job data shape
export interface SkillJobData {
  skillId: string;
  args: Record<string, unknown>;
  workspaceId: string;
  callerId: string;
  traceId?: string;
}

export interface SkillJobResult {
  success: boolean;
  value?: unknown;
  error?: string;
}

// Create a worker that processes skill jobs
export function createSkillWorker(
  processor: (job: Job<SkillJobData>) => Promise<SkillJobResult>,
  opts?: { concurrency?: number },
): Worker<SkillJobData, SkillJobResult> {
  const worker = new Worker<SkillJobData, SkillJobResult>(
    'skill-execution',
    processor,
    {
      connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }),
      concurrency: opts?.concurrency ?? 5,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`Skill job ${job?.id} failed:`, err.message);
  });

  return worker;
}

// Agent execution queue
export interface AgentJobData {
  taskId: string;
  agentId: string;
  workspaceId: string;
  callerId: string;
  message: import('../a2a/types').A2AMessage;
  sessionId?: string;
}

export const agentQueue = new Queue<AgentJobData>('agent-run', { connection });

export function enqueueAgentRun(data: AgentJobData): Promise<Job<AgentJobData>> {
  return agentQueue.add('run', data, { attempts: 1, removeOnComplete: 100, removeOnFail: 200 });
}

// Orchestration execution queue
export interface OrchestrationJobData {
  orchestrationId: string;
  workspaceId: string;
  definition: import('../../modules/orchestration/orchestration.types').OrchestrationDefinition;
  input: Record<string, unknown>;
}

export const orchestrationQueue = new Queue<OrchestrationJobData>('orchestration-run', { connection });

export const cleanupQueue = new Queue('cleanup', { connection });

export const syncQueue = new Queue('sync', { connection });

// Learning & adaptation queues
export const learningQueue = new Queue('learning-cycle', { connection });
export const adaptationAgentQueue = new Queue('adaptation-agent', { connection });

export function enqueueOrchestration(data: OrchestrationJobData): Promise<Job<OrchestrationJobData>> {
  return orchestrationQueue.add('run', data, { attempts: 1, removeOnComplete: 100, removeOnFail: 200 });
}

// QueueEvents instance for listening to skill job completions
const skillQueueEvents = new QueueEvents('skill-execution', {
  connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }),
});

// Enqueue a skill execution and wait for result
export async function enqueueSkill(data: SkillJobData, opts?: { timeout?: number }): Promise<SkillJobResult> {
  const job = await skillQueue.add('execute', data, {
    removeOnComplete: 100,
    removeOnFail: 50,
  });

  const result = await job.waitUntilFinished(skillQueueEvents, opts?.timeout ?? 30_000);
  return result;
}
