import type { AIProvider, ToolChoice } from '../ai/types';

export const COORDINATOR_SYSTEM_PROMPT = `You are a coordinator agent. Your responsibilities:
- Synthesize findings from sub-agents into coherent, actionable output
- Always reference specific findings with file:line or exact evidence
- Provide clear reasoning for any conclusion
- Never delegate understanding — if you don't understand something, ask
- When delegating tasks, be explicit about expected output format and success criteria
- Keep responses concise: prefer bullet points with references over narrative prose
- After receiving sub-agent results, synthesize first, then provide specific instructions`.trim();

export const COORDINATOR_ALLOWED_TOOLS: string[] = [
  'send_task',
  'get_task_status',
  'send_message',
  'list_agents',
];

export interface AgentConfig {
  id: string;
  provider: AIProvider;
  mode: 'raw' | 'agent-sdk';
  model: string;
  systemPrompt?: string;
  toolIds?: string[];
  workspaceId: string;
  temperature?: number;
  maxTokens?: number;
  toolChoice?: ToolChoice;
  disableParallelToolUse?: boolean;
}

export function createCoordinatorConfig(
  workspaceId: string,
  overrides?: Partial<Omit<AgentConfig, 'workspaceId'>>,
): AgentConfig {
  return {
    id: `coordinator-${workspaceId}`,
    provider: 'anthropic',
    mode: 'raw',
    model: 'claude-opus-4-6',
    systemPrompt: COORDINATOR_SYSTEM_PROMPT,
    toolIds: COORDINATOR_ALLOWED_TOOLS,
    workspaceId,
    temperature: 0.3,
    maxTokens: 8192,
    ...overrides,
  };
}
