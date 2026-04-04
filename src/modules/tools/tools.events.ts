export interface ToolCreatedEvent {
  toolId: string;
  workspaceId: string | null;
  name: string;
}

export interface ToolUpdatedEvent {
  toolId: string;
  changes: string[];
}
