import { describe, it, expect } from 'bun:test';
import { getProvider, listProviders } from '../registry';

describe('oauth registry', () => {
  it('returns known providers', () => {
    for (const id of ['claude', 'google', 'openai', 'github']) {
      const p = getProvider(id);
      expect(p.id).toBe(id);
      expect(p.displayName).toBeTruthy();
      expect(['authorization_code_pkce', 'device_code']).toContain(p.flowType);
    }
  });

  it('throws on unknown provider', () => {
    expect(() => getProvider('nonexistent')).toThrow('Unknown OAuth provider: nonexistent');
  });

  it('listProviders returns all registered ids', () => {
    const ids = listProviders().map(p => p.id);
    expect(ids).toContain('claude');
    expect(ids).toContain('google');
    expect(ids).toContain('openai');
    expect(ids).toContain('github');
  });

  it('pkce providers have buildAuthUrl + exchangeCode', () => {
    const claude = getProvider('claude');
    expect(typeof claude.buildAuthUrl).toBe('function');
    expect(typeof claude.exchangeCode).toBe('function');
  });

  it('device_code providers have requestDeviceCode + pollToken', () => {
    const github = getProvider('github');
    expect(typeof github.requestDeviceCode).toBe('function');
    expect(typeof github.pollToken).toBe('function');
  });
});
