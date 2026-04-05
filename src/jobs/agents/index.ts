import { Worker } from 'bullmq';
import type { AgentJobData } from '../../infra/queue/bullmq';
import { redis } from '../../infra/queue/bullmq';
import { taskManager } from '../../infra/a2a/task-manager';
import { agentsService } from '../../modules/agents/agents.service';
import { logger } from '../../config/logger';

export function startAgentWorkers(concurrency = 3): Worker<AgentJobData> {
  const worker = new Worker<AgentJobData>(
    'agent:run',
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
    { connection: redis, concurrency },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, taskId: job?.data.taskId, err }, 'Agent job failed');
  });

  return worker;
}
