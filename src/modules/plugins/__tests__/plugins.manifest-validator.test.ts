import { describe, it, expect } from 'bun:test';
import { validatePluginConfig, checkPermissions } from '../plugins.manifest-validator';

describe('validatePluginConfig', () => {
  it('returns valid when no schema provided', () => {
    expect(validatePluginConfig({}, undefined)).toEqual({ valid: true });
  });

  it('fails when required field missing', () => {
    const schema = { required: ['apiUrl'], properties: { apiUrl: { type: 'string' } } };
    const result = validatePluginConfig({}, schema);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('apiUrl');
  });

  it('fails on type mismatch', () => {
    const schema = { properties: { port: { type: 'number' } } };
    const result = validatePluginConfig({ port: 'not-a-number' }, schema);
    expect(result.valid).toBe(false);
  });

  it('passes when config matches schema', () => {
    const schema = { required: ['apiUrl'], properties: { apiUrl: { type: 'string' }, port: { type: 'number' } } };
    expect(validatePluginConfig({ apiUrl: 'https://example.com', port: 443 }, schema)).toEqual({ valid: true });
  });
});

describe('checkPermissions', () => {
  it('allows when caller has all required permissions', () => {
    expect(checkPermissions(['workspace:read', 'erp:read'], ['workspace:read'])).toEqual({ allowed: true });
  });

  it('denies and returns missing permissions', () => {
    const result = checkPermissions(['workspace:read'], ['workspace:read', 'erp:write']);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.missing).toContain('erp:write');
  });
});
