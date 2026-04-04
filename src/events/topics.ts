export const Topics = {
  // Skills
  SKILL_REGISTERED: 'skill:registered',
  SKILL_INVOKED: 'skill:invoked',
  SKILL_FAILED: 'skill:failed',
  // Tasks
  TASK_CREATED: 'task:created',
  TASK_STATUS: 'task:status',
  TASK_TEXT_DELTA: 'task:text_delta',
  TASK_TOOL_CALL: 'task:tool_call',
  TASK_ARTIFACT: 'task:artifact',
  TASK_ERROR: 'task:error',
  TASK_COMPLETED: 'task:completed',
  // Agents
  AGENT_CREATED: 'agent:created',
  AGENT_UPDATED: 'agent:updated',
  AGENT_RUN_STARTED: 'agent:run:started',
  AGENT_RUN_COMPLETED: 'agent:run:completed',
  // MCP
  MCP_CONNECTED: 'mcp:connected',
  MCP_DISCONNECTED: 'mcp:disconnected',
  MCP_TOOLS_DISCOVERED: 'mcp:tools:discovered',
  // System
  HEARTBEAT: 'system:heartbeat',
} as const;

export type Topic = typeof Topics[keyof typeof Topics];
