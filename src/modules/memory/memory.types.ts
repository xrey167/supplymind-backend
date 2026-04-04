export type MemoryType = 'domain' | 'feedback' | 'pattern' | 'reference';
export type MemorySource = 'explicit' | 'proposed' | 'approved';
export type ProposalStatus = 'pending' | 'approved' | 'rejected';

export interface AgentMemory {
  id: string;
  workspaceId: string;
  agentId?: string;
  type: MemoryType;
  title: string;
  content: string;
  confidence: number;
  source: MemorySource;
  metadata: Record<string, unknown>;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryProposal {
  id: string;
  workspaceId: string;
  agentId: string;
  type: MemoryType;
  title: string;
  content: string;
  evidence?: string;
  sessionId?: string;
  status: ProposalStatus;
  rejectionReason?: string;
  createdAt: Date;
  reviewedAt?: Date;
}

export interface SaveMemoryInput {
  workspaceId: string;
  agentId?: string;
  type: MemoryType;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  expiresAt?: Date;
}

export interface ProposeMemoryInput {
  workspaceId: string;
  agentId: string;
  type: MemoryType;
  title: string;
  content: string;
  evidence?: string;
  sessionId?: string;
}

export interface RecallInput {
  query: string;
  workspaceId: string;
  agentId?: string;
  limit?: number;
}
