import type { Message } from '../../infra/ai/types';
import { buildContext } from './context.builder';

interface PrepareInput {
  messages: Message[];
  agentConfig: {
    model: string;
    systemPrompt?: string;
    workspaceId: string;
    agentId?: string;
  };
  workspace?: {
    name?: string;
    description?: string;
    goals?: string[];
  };
}

export const contextService = {
  async prepare(input: PrepareInput) {
    return buildContext(input.messages, input.agentConfig, input.workspace);
  },
};
