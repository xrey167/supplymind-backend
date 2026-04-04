export interface AgentCreatedEvent {
  agentId: string;
  workspaceId: string;
  name: string;
}

export interface AgentUpdatedEvent {
  agentId: string;
  changes: string[];
}
