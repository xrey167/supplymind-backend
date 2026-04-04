export interface RegisteredAgent {
  id: string;
  workspaceId: string;
  url: string;
  agentCard: Record<string, unknown>;
  enabled: boolean;
  lastDiscoveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
