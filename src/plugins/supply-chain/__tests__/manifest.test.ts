import { describe, test, expect } from 'bun:test';
import { supplyChainManifest } from '../manifest';
import { SupplyChainTopics } from '../topics';
import { SUPPLY_CHAIN_ROLE_ENTRIES } from '../roles';

describe('supplyChainManifest', () => {
  test('has required manifest fields', () => {
    expect(supplyChainManifest.id).toBe('supply-chain');
    expect(supplyChainManifest.name).toBeTruthy();
    expect(supplyChainManifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(supplyChainManifest.description).toBeTruthy();
  });

  describe('contributions.topics', () => {
    test('includes all supply chain topic keys', () => {
      const topics = supplyChainManifest.contributions?.topics ?? {};
      for (const [key, value] of Object.entries(SupplyChainTopics)) {
        expect(topics[key]).toBe(value);
      }
    });

    test('all topic values start with supply_chain.', () => {
      const topics = supplyChainManifest.contributions?.topics ?? {};
      for (const value of Object.values(topics)) {
        expect(value).toMatch(/^supply_chain\./);
      }
    });

    test('has 11 topics', () => {
      const topics = supplyChainManifest.contributions?.topics ?? {};
      expect(Object.keys(topics)).toHaveLength(11);
    });
  });

  describe('contributions.roles', () => {
    test('includes all 4 supply chain role entries', () => {
      const roles = supplyChainManifest.contributions?.roles ?? [];
      expect(roles).toHaveLength(4);
    });

    test('matches SUPPLY_CHAIN_ROLE_ENTRIES', () => {
      expect(supplyChainManifest.contributions?.roles).toEqual(SUPPLY_CHAIN_ROLE_ENTRIES);
    });

    test('each role has required fields', () => {
      const roles = supplyChainManifest.contributions?.roles ?? [];
      for (const r of roles) {
        expect(r.role).toBeTruthy();
        expect(['operator', 'agent', 'admin', 'viewer', 'system']).toContain(r.privilege);
        expect(Array.isArray(r.allowedToolPrefixes)).toBe(true);
        expect(r.allowedToolPrefixes.length).toBeGreaterThan(0);
      }
    });

    test('procurement_manager maps to operator', () => {
      const roles = supplyChainManifest.contributions?.roles ?? [];
      const pm = roles.find(r => r.role === 'procurement_manager');
      expect(pm?.privilege).toBe('operator');
    });

    test('finance_approver maps to admin', () => {
      const roles = supplyChainManifest.contributions?.roles ?? [];
      const fa = roles.find(r => r.role === 'finance_approver');
      expect(fa?.privilege).toBe('admin');
    });

    test('warehouse_operator maps to agent', () => {
      const roles = supplyChainManifest.contributions?.roles ?? [];
      const wo = roles.find(r => r.role === 'warehouse_operator');
      expect(wo?.privilege).toBe('agent');
    });
  });

  describe('contributions.permissionLayers', () => {
    test('includes one permission layer named supply-chain-role', () => {
      const layers = supplyChainManifest.contributions?.permissionLayers ?? [];
      expect(layers).toHaveLength(1);
      expect(layers[0].name).toBe('supply-chain-role');
    });
  });
});
