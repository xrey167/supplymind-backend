import { describe, it, expect } from 'bun:test';
import { Topics } from '../topics';

describe('Foundation event topics', () => {
  it('has workspace lifecycle topics', () => {
    expect(Topics.WORKSPACE_CREATED).toBe('workspace.created');
    expect(Topics.WORKSPACE_UPDATED).toBe('workspace.updated');
    expect(Topics.WORKSPACE_DELETING).toBe('workspace.deleting');
    expect(Topics.WORKSPACE_DELETED).toBe('workspace.deleted');
  });

  it('has member lifecycle topics', () => {
    expect(Topics.MEMBER_INVITED).toBe('member.invited');
    expect(Topics.MEMBER_JOINED).toBe('member.joined');
    expect(Topics.MEMBER_REMOVED).toBe('member.removed');
    expect(Topics.MEMBER_ROLE_CHANGED).toBe('member.role_changed');
  });

  it('has user sync topics', () => {
    expect(Topics.USER_SYNCED).toBe('user.synced');
    expect(Topics.USER_DELETED).toBe('user.deleted');
  });

  it('has coordinator phase topics', () => {
    expect(Topics.COORDINATOR_PHASE_CHANGED).toBe('coordinator.phase_changed');
    expect(Topics.COORDINATOR_PHASE_COMPLETED).toBe('coordinator.phase_completed');
  });

  it('has verification verdict topic', () => {
    expect(Topics.VERIFICATION_VERDICT).toBe('verification.verdict');
  });

  it('has tool approval expiry topic', () => {
    expect(Topics.TOOL_APPROVAL_EXPIRED).toBe('tool.approval_expired');
  });
});

describe('Supply chain event topics', () => {
  it('has order domain event topics', () => {
    expect(Topics.SUPPLY_CHAIN_ORDER_CREATED).toBe('supply_chain.order.created');
    expect(Topics.SUPPLY_CHAIN_ORDER_UPDATED).toBe('supply_chain.order.updated');
    expect(Topics.SUPPLY_CHAIN_ORDER_CANCELLED).toBe('supply_chain.order.cancelled');
  });

  it('has shipment domain event topics', () => {
    expect(Topics.SUPPLY_CHAIN_SHIPMENT_DISPATCHED).toBe('supply_chain.shipment.dispatched');
    expect(Topics.SUPPLY_CHAIN_SHIPMENT_DELAYED).toBe('supply_chain.shipment.delayed');
    expect(Topics.SUPPLY_CHAIN_SHIPMENT_DELIVERED).toBe('supply_chain.shipment.delivered');
  });

  it('has inventory domain event topics', () => {
    expect(Topics.SUPPLY_CHAIN_INVENTORY_LOW_STOCK).toBe('supply_chain.inventory.low_stock');
    expect(Topics.SUPPLY_CHAIN_INVENTORY_UPDATED).toBe('supply_chain.inventory.updated');
  });

  it('has supply chain alert topics', () => {
    expect(Topics.SUPPLY_CHAIN_ALERT_LOW_STOCK).toBe('supply_chain.alert.low_stock');
    expect(Topics.SUPPLY_CHAIN_ALERT_SUPPLIER_RISK).toBe('supply_chain.alert.supplier_risk');
    expect(Topics.SUPPLY_CHAIN_ALERT_PRICE_CHANGE).toBe('supply_chain.alert.price_change');
    expect(Topics.SUPPLY_CHAIN_ALERT_SHIPMENT_DELAY).toBe('supply_chain.alert.shipment_delay');
  });

  it('has supply chain sync topics', () => {
    expect(Topics.SUPPLY_CHAIN_SYNC_COMPLETED).toBe('supply_chain.sync.completed');
    expect(Topics.SUPPLY_CHAIN_SYNC_FAILED).toBe('supply_chain.sync.failed');
  });

  it('all topic values are unique strings', () => {
    const values = Object.values(Topics);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});
