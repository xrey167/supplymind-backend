import type { AgentCard } from '../../engine/a2a/types';

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
