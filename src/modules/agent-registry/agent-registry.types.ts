import type { AgentCard } from '../../infra/a2a/types';

export interface RegisteredAgent {
  id: string;
  workspaceId: string;
  url: string;
  agentCard: AgentCard;
  enabled: boolean;
  lastDiscoveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
