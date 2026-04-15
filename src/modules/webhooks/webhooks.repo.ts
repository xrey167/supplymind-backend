import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { webhookEndpoints, webhookDeliveries } from '../../infra/db/schema';
import { BaseRepo } from '../../infra/db/repositories/base.repo';
import type { WebhookEndpoint, WebhookDelivery, WebhookDeliveryStatus } from './webhooks.types';

type EndpointRow = typeof webhookEndpoints.$inferSelect;
type NewEndpointRow = typeof webhookEndpoints.$inferInsert;

function toEndpoint(row: EndpointRow): WebhookEndpoint {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    token: row.token,
    active: row.active,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDelivery(row: typeof webhookDeliveries.$inferSelect): WebhookDelivery {
  return {
    id: row.id,
    endpointId: row.endpointId,
    workspaceId: row.workspaceId,
    deliveryKey: row.deliveryKey,
    payload: row.payload as Record<string, unknown>,
    headers: row.headers as Record<string, unknown>,
    status: row.status as WebhookDeliveryStatus,
    processedAt: row.processedAt,
    createdAt: row.createdAt,
  };
}

export class WebhooksRepo extends BaseRepo<typeof webhookEndpoints, EndpointRow, NewEndpointRow> {
  constructor() { super(webhookEndpoints); }

  async createEndpoint(values: {
    workspaceId: string;
    name: string;
    description?: string;
    token: string;
    secretHash: string;
    createdBy: string;
  }): Promise<WebhookEndpoint> {
    const rows = await db.insert(webhookEndpoints).values({
      workspaceId: values.workspaceId,
      name: values.name,
      description: values.description ?? null,
      token: values.token,
      secretHash: values.secretHash,
      createdBy: values.createdBy,
    }).returning();
    return toEndpoint(rows[0]!);
  }

  async findByToken(token: string): Promise<(WebhookEndpoint & { secretHash: string }) | null> {
    const rows = await db.select().from(webhookEndpoints)
      .where(eq(webhookEndpoints.token, token)).limit(1);
    if (!rows[0]) return null;
    return { ...toEndpoint(rows[0]), secretHash: rows[0].secretHash };
  }

  async findEndpointOwned(id: string, workspaceId: string): Promise<WebhookEndpoint | null> {
    const rows = await db.select().from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.workspaceId, workspaceId))).limit(1);
    return rows[0] ? toEndpoint(rows[0]) : null;
  }

  async listEndpoints(workspaceId: string): Promise<WebhookEndpoint[]> {
    const rows = await db.select().from(webhookEndpoints)
      .where(eq(webhookEndpoints.workspaceId, workspaceId))
      .orderBy(desc(webhookEndpoints.createdAt));
    return rows.map(toEndpoint);
  }

  async deleteEndpoint(id: string, workspaceId: string): Promise<void> {
    await db.delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.workspaceId, workspaceId)));
  }

  // Returns null on dedup conflict (delivery already exists)
  async insertDelivery(values: {
    endpointId: string;
    workspaceId: string;
    deliveryKey: string;
    payload: Record<string, unknown>;
    headers: Record<string, string>;
  }): Promise<WebhookDelivery | null> {
    const rows = await db.insert(webhookDeliveries).values({
      endpointId: values.endpointId,
      workspaceId: values.workspaceId,
      deliveryKey: values.deliveryKey,
      payload: values.payload,
      headers: values.headers,
    }).onConflictDoNothing().returning();
    return rows[0] ? toDelivery(rows[0]) : null;
  }

  async markDeliveryProcessed(id: string): Promise<void> {
    await db.update(webhookDeliveries)
      .set({ status: 'processed', processedAt: new Date() })
      .where(eq(webhookDeliveries.id, id));
  }

  async listDeliveries(endpointId: string, workspaceId: string, limit = 50): Promise<WebhookDelivery[]> {
    const rows = await db.select().from(webhookDeliveries)
      .where(and(
        eq(webhookDeliveries.endpointId, endpointId),
        eq(webhookDeliveries.workspaceId, workspaceId),
      ))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit);
    return rows.map(toDelivery);
  }
}

export const webhooksRepo = new WebhooksRepo();
