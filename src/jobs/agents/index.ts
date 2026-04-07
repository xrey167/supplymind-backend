import { Worker } from 'bullmq';
import Redis from 'ioredis';
import type { AgentJobData } from '../../infra/queue/bullmq';
import { taskManager } from '../../infra/a2a/task-manager';
import { taskRepo } from '../../infra/a2a/task-repo';
import { agentsService as defaultAgentsService } from '../../modules/agents/agents.service';
import type { AgentsService } from '../../modules/agents/agents.service';
import { logger } from '../../config/logger';

const REDIS_URL = Bun.env.REDIS_URL ?? 'redis://localhost:6379';

export function startAgentWorkers(concurrency = 3, agentsService: Pick<AgentsService, 'getById'> = defaultAgentsService): { worker: Worker<AgentJobData>; connection: Redis } {
  const workerRedis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

  const worker = new Worker<AgentJobData>(
    'agent-run',
    async (job) => {
      const { taskId, agentId, workspaceId, callerId, message, sessionId } = job.data;

      const agentResult = await agentsService.getById(agentId);
      if (!agentResult.ok) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      const agent = agentResult.value;

      await taskManager.send({
        id: taskId,
        message,
        sessionId,
        agentConfig: {
          id: agent.id,
          provider: agent.provider,
          mode: agent.mode,
          model: agent.model,
          systemPrompt: agent.systemPrompt,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          toolIds: agent.toolIds,
          workspaceId,
        },
        callerId,
      });
    },
    { connection: workerRedis, concurrency },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, taskId: job?.data.taskId, err }, 'Agent job failed');
    if (job?.data.taskId) {
      taskRepo.updateStatus(job.data.taskId, 'failed', String(err)).catch((e: unknown) => {
        logger.error({ e }, 'Failed to mark task as failed after job failure');
      });
    }
  });

  return { worker, connection: workerRedis };
}
