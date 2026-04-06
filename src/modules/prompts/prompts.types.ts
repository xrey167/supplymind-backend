export interface PromptVariable {
  name: string;
  description?: string;
  default?: string;
}

export interface Prompt {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  content: string;
  variables: PromptVariable[];
  tags: string[];
  version: number;
  isActive: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePromptInput {
  workspaceId: string;
  name: string;
  description?: string;
  content: string;
  variables?: PromptVariable[];
  tags?: string[];
  createdBy?: string;
}

export interface UpdatePromptInput {
  name?: string;
  description?: string;
  content?: string;
  variables?: PromptVariable[];
  tags?: string[];
  isActive?: boolean;
}

export interface RenderPromptInput {
  promptId: string;
  variables: Record<string, string>;
}
