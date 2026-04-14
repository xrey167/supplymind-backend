import { describe, test, expect, beforeEach } from 'bun:test';
import {
  mapWorkspaceRole,
  isKnownWorkspaceRole,
  registerWorkspaceRole,
  deregisterWorkspaceRole,
  _resetWorkspaceRoleExtensions,
} from '../rbac';

describe('RBAC workspace role extensions', () => {
  beforeEach(() => {
    _resetWorkspaceRoleExtensions();
  });

  describe('registerWorkspaceRole', () => {
    test('registered role is known', () => {
      registerWorkspaceRole('custom_role', 'operator');
      expect(isKnownWorkspaceRole('custom_role')).toBe(true);
    });

    test('registered role maps to the given privilege', () => {
      registerWorkspaceRole('custom_role', 'operator');
      expect(mapWorkspaceRole('custom_role')).toBe('operator');
    });

    test('last write wins when registering the same role twice', () => {
      registerWorkspaceRole('custom_role', 'operator');
      registerWorkspaceRole('custom_role', 'admin');
      expect(mapWorkspaceRole('custom_role')).toBe('admin');
    });

    test('can register multiple distinct roles', () => {
      registerWorkspaceRole('role_a', 'agent');
      registerWorkspaceRole('role_b', 'operator');
      expect(mapWorkspaceRole('role_a')).toBe('agent');
      expect(mapWorkspaceRole('role_b')).toBe('operator');
    });
  });

  describe('deregisterWorkspaceRole', () => {
    test('deregistered role is no longer known', () => {
      registerWorkspaceRole('custom_role', 'operator');
      deregisterWorkspaceRole('custom_role');
      expect(isKnownWorkspaceRole('custom_role')).toBe(false);
    });

    test('deregistered role falls back to viewer', () => {
      registerWorkspaceRole('custom_role', 'operator');
      deregisterWorkspaceRole('custom_role');
      expect(mapWorkspaceRole('custom_role')).toBe('viewer');
    });

    test('deregistering an unknown role is a no-op', () => {
      expect(() => deregisterWorkspaceRole('does_not_exist')).not.toThrow();
    });
  });

  describe('core roles are unaffected', () => {
    test('owner maps to admin', () => {
      expect(mapWorkspaceRole('owner')).toBe('admin');
    });

    test('member maps to operator', () => {
      expect(mapWorkspaceRole('member')).toBe('operator');
    });

    test('viewer maps to viewer', () => {
      expect(mapWorkspaceRole('viewer')).toBe('viewer');
    });

    test('core roles remain known after reset', () => {
      _resetWorkspaceRoleExtensions();
      expect(isKnownWorkspaceRole('owner')).toBe(true);
      expect(isKnownWorkspaceRole('admin')).toBe(true);
      expect(isKnownWorkspaceRole('member')).toBe(true);
    });

    test('registering an extension does not affect core roles', () => {
      registerWorkspaceRole('custom_role', 'agent');
      expect(mapWorkspaceRole('owner')).toBe('admin');
      expect(mapWorkspaceRole('member')).toBe('operator');
    });
  });

  describe('_resetWorkspaceRoleExtensions', () => {
    test('clears all plugin-contributed roles', () => {
      registerWorkspaceRole('role_a', 'agent');
      registerWorkspaceRole('role_b', 'operator');
      _resetWorkspaceRoleExtensions();
      expect(isKnownWorkspaceRole('role_a')).toBe(false);
      expect(isKnownWorkspaceRole('role_b')).toBe(false);
    });

    test('after reset, cleared roles fall back to viewer', () => {
      registerWorkspaceRole('custom_role', 'admin');
      _resetWorkspaceRoleExtensions();
      expect(mapWorkspaceRole('custom_role')).toBe('viewer');
    });
  });

  describe('unknown roles', () => {
    test('unknown role is not known', () => {
      expect(isKnownWorkspaceRole('totally_unknown')).toBe(false);
    });

    test('unknown role maps to viewer (safe default)', () => {
      expect(mapWorkspaceRole('totally_unknown')).toBe('viewer');
    });
  });
});
