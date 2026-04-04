import type { Message } from '../../infra/ai/types';
import { estimateTokens, totalMessageTokens, getBudget, messageBudget } from './context.tracker';
import { snipMessages } from './context.snip';
import { compactMessages } from './context.compact';
import { memoryService } from '../memory/memory.service';

interface AgentConfig {
  model: string;
  systemPrompt?: string;
  workspaceId: string;
  agentId?: string;
}

interface WorkspaceContext {
  name?: string;
  description?: string;
  goals?: string[];
}

interface PreparedContext {
  systemPrompt: string;
  messages: Message[];
  estimatedTokens: number;
  wasCompacted: boolean;
}

export async function buildContext(
  messages: Message[],
  agentConfig: AgentConfig,
  workspace?: WorkspaceContext,
): Promise<PreparedContext> {
  const budget = getBudget(agentConfig.model);
  const maxMessageTokens = messageBudget(budget);

  const systemParts: string[] = [];

  if (agentConfig.systemPrompt) {
    systemParts.push(agentConfig.systemPrompt);
  }

  if (workspace?.name) {
    const wsContext = [`[Workspace] ${workspace.name}`];
    if (workspace.description) wsContext.push(workspace.description);
    if (workspace.goals?.length) wsContext.push(`Goals: ${workspace.goals.join('; ')}`);
    systemParts.push(wsContext.join('\n'));
  }

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (lastUserMsg) {
    const query = typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '';
    if (query.length > 0) {
      try {
        const memories = await memoryService.recall({
          query,
          workspaceId: agentConfig.workspaceId,
          agentId: agentConfig.agentId,
          limit: 5,
        });
        if (memories.length > 0) {
          const memoryText = memories
            .map((m) => `- [${m.type}] ${m.title}: ${m.content}`)
            .join('\n');
          const memTokens = estimateTokens(memoryText);
          if (memTokens <= 2000) {
            systemParts.push(`[Relevant Memories]\n${memoryText}`);
          } else {
            const maxChars = 2000 * 3;
            systemParts.push(`[Relevant Memories]\n${memoryText.slice(0, maxChars)}`);
          }
        }
      } catch {
        // Memory recall failed — continue without memories
      }
    }
  }

  const systemPrompt = systemParts.join('\n\n');

  let processedMessages = snipMessages(messages, messages.length);

  let currentTokens = totalMessageTokens(processedMessages);
  let wasCompacted = false;

  if (currentTokens > maxMessageTokens * 0.7) {
    const { summary, keptMessages } = await compactMessages(processedMessages);
    if (summary.content) {
      processedMessages = [summary, ...keptMessages];
      wasCompacted = true;
      currentTokens = totalMessageTokens(processedMessages);
    }
  }

  return {
    systemPrompt,
    messages: processedMessages,
    estimatedTokens: currentTokens + estimateTokens(systemPrompt),
    wasCompacted,
  };
}
