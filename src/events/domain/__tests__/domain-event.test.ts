import { describe, it, expect } from 'bun:test';
import type { DomainEvent, DomainEventEnvelope } from '../types';

describe('DomainEvent types', () => {
  it('DomainEventEnvelope has required fields', () => {
    const envelope: DomainEventEnvelope<{ orderId: string }> = {
      eventId: 'evt_001',
      type: 'order.created',
      workspaceId: 'ws_1',
      occurredAt: new Date(),
      payload: { orderId: 'ord_1' },
      version: 1,
    };
    expect(envelope.eventId).toBe('evt_001');
    expect(envelope.type).toBe('order.created');
    expect(envelope.version).toBe(1);
  });

  it('DomainEvent payload is generic', () => {
    type MyEvent = DomainEvent<'user.updated', { userId: string; changes: Record<string, unknown> }>;
    const event: MyEvent = {
      eventId: 'e1',
      type: 'user.updated',
      workspaceId: 'ws_1',
      occurredAt: new Date(),
      payload: { userId: 'u_1', changes: { name: 'Alice' } },
      version: 1,
    };
    expect(event.payload.userId).toBe('u_1');
  });

  it('createDomainEvent factory sets defaults', () => {
    // Import the factory function too
    const { createDomainEvent } = require('../types');
    const event = createDomainEvent('task.completed', 'ws_1', { taskId: 'task_1' });
    expect(event.type).toBe('task.completed');
    expect(event.workspaceId).toBe('ws_1');
    expect(event.payload.taskId).toBe('task_1');
    expect(event.version).toBe(1);
    expect(typeof event.eventId).toBe('string');
    expect(event.occurredAt instanceof Date).toBe(true);
  });
});
