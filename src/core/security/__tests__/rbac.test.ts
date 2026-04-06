import { describe, test, it, expect } from 'bun:test';
import { Roles, hasPermission, isValidRole, getRequiredRole, PROVIDER_REQUIRED_ROLE, mapWorkspaceRole } from '../rbac';

describe('RBAC', () => {
  describe('Roles', () => {
    test('should define all expected roles', () => {
      expect(Roles.SYSTEM).toBe('system');
      expect(Roles.ADMIN).toBe('admin');
      expect(Roles.OPERATOR).toBe('operator');
      expect(Roles.AGENT).toBe('agent');
      expect(Roles.VIEWER).toBe('viewer');
    });
  });

  describe('hasPermission', () => {
    test('system should have permission for all roles', () => {
      expect(hasPermission('system', 'system')).toBe(true);
      expect(hasPermission('system', 'admin')).toBe(true);
      expect(hasPermission('system', 'viewer')).toBe(true);
    });

    test('admin should have permission for admin and below', () => {
      expect(hasPermission('admin', 'admin')).toBe(true);
      expect(hasPermission('admin', 'operator')).toBe(true);
      expect(hasPermission('admin', 'agent')).toBe(true);
      expect(hasPermission('admin', 'viewer')).toBe(true);
    });

    test('admin should NOT have permission for system', () => {
      expect(hasPermission('admin', 'system')).toBe(false);
    });

    test('operator should have permission for operator and below', () => {
      expect(hasPermission('operator', 'operator')).toBe(true);
      expect(hasPermission('operator', 'agent')).toBe(true);
      expect(hasPermission('operator', 'viewer')).toBe(true);
    });

    test('operator should NOT have permission for admin', () => {
      expect(hasPermission('operator', 'admin')).toBe(false);
    });

    test('agent should have permission for agent and viewer', () => {
      expect(hasPermission('agent', 'agent')).toBe(true);
      expect(hasPermission('agent', 'viewer')).toBe(true);
    });

    test('agent should NOT have permission for operator', () => {
      expect(hasPermission('agent', 'operator')).toBe(false);
    });

    test('viewer should only have permission for viewer', () => {
      expect(hasPermission('viewer', 'viewer')).toBe(true);
      expect(hasPermission('viewer', 'agent')).toBe(false);
    });

    test('unknown role should be denied', () => {
      expect(hasPermission('unknown', 'viewer')).toBe(false);
      expect(hasPermission('', 'viewer')).toBe(false);
    });
  });

  describe('isValidRole', () => {
    test('should return true for all known roles', () => {
      expect(isValidRole('system')).toBe(true);
      expect(isValidRole('admin')).toBe(true);
      expect(isValidRole('operator')).toBe(true);
      expect(isValidRole('agent')).toBe(true);
      expect(isValidRole('viewer')).toBe(true);
    });

    test('should return false for unknown roles', () => {
      expect(isValidRole('superadmin')).toBe(false);
      expect(isValidRole('user')).toBe(false);
      expect(isValidRole('')).toBe(false);
    });
  });

  describe('getRequiredRole', () => {
    test('should return provider default when no explicit role', () => {
      expect(getRequiredRole('inline')).toBe('admin');
      expect(getRequiredRole('mcp')).toBe('operator');
      expect(getRequiredRole('worker')).toBe('agent');
      expect(getRequiredRole('plugin')).toBe('agent');
      expect(getRequiredRole('builtin')).toBe('viewer');
    });

    test('should return explicit role when valid', () => {
      expect(getRequiredRole('builtin', 'admin')).toBe('admin');
      expect(getRequiredRole('inline', 'viewer')).toBe('viewer');
    });

    test('should fall back to provider default for invalid explicit role', () => {
      expect(getRequiredRole('mcp', 'superadmin')).toBe('operator');
    });

    test('should require admin for unknown provider types', () => {
      expect(getRequiredRole('unknown')).toBe('admin');
    });
  });

  describe('PROVIDER_REQUIRED_ROLE', () => {
    test('inline tools should require admin', () => {
      expect(PROVIDER_REQUIRED_ROLE.inline).toBe('admin');
    });

    test('mcp tools should require operator', () => {
      expect(PROVIDER_REQUIRED_ROLE.mcp).toBe('operator');
    });

    test('builtin tools should require viewer', () => {
      expect(PROVIDER_REQUIRED_ROLE.builtin).toBe('viewer');
    });
  });
});

describe('mapWorkspaceRole', () => {
  it('maps owner to admin', () => {
    expect(mapWorkspaceRole('owner')).toBe('admin');
  });

  it('maps admin to admin', () => {
    expect(mapWorkspaceRole('admin')).toBe('admin');
  });

  it('maps member to operator', () => {
    expect(mapWorkspaceRole('member')).toBe('operator');
  });

  it('maps viewer to viewer', () => {
    expect(mapWorkspaceRole('viewer')).toBe('viewer');
  });

  it('maps unknown role to viewer (safe default)', () => {
    expect(mapWorkspaceRole('nonsense')).toBe('viewer');
  });
});

describe('hasPermission with mapped workspace roles', () => {
  it('mapped owner (admin) can access operator-level resources', () => {
    const mapped = mapWorkspaceRole('owner');
    expect(hasPermission(mapped, 'operator')).toBe(true);
  });

  it('mapped member (operator) cannot access admin-level resources', () => {
    const mapped = mapWorkspaceRole('member');
    expect(hasPermission(mapped, 'admin')).toBe(false);
  });

  it('mapped viewer can only access viewer-level resources', () => {
    const mapped = mapWorkspaceRole('viewer');
    expect(hasPermission(mapped, 'viewer')).toBe(true);
    expect(hasPermission(mapped, 'operator')).toBe(false);
  });
});
