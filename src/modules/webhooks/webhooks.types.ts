export type WebhookDeliveryStatus = 'received' | 'processed' | 'duplicate' | 'failed';

export interface WebhookEndpoint {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  token: string;
  active: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  workspaceId: string;
  deliveryKey: string;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  processedAt: Date | null;
  createdAt: Date;
}

export interface CreateEndpointInput {
  workspaceId: string;
  name: string;
  description?: string;
  createdBy: string;
}

export interface IngestInput {
  token: string;
  rawBody: string;
  signature: string;
  deliveryKey: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
}

export interface IngestResult {
  accepted: boolean;
  duplicate: boolean;
}
