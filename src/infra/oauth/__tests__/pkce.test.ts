import { describe, it, expect } from 'bun:test';
import { generateCodeVerifier, generateCodeChallenge, generateState, generatePKCE } from '../pkce';

describe('pkce', () => {
  it('generates verifier of 43-128 chars from base64url alphabet', () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(/^[A-Za-z0-9\-._~]+$/.test(v)).toBe(true);
  });

  it('generates S256 challenge as base64url string', () => {
    const v = generateCodeVerifier();
    const c = generateCodeChallenge(v);
    expect(c.length).toBe(43);
    expect(/^[A-Za-z0-9\-_]+$/.test(c)).toBe(true);
  });

  it('generates unique states', () => {
    const s1 = generateState();
    const s2 = generateState();
    expect(s1).not.toBe(s2);
  });

  it('generatePKCE returns all three fields', () => {
    const { codeVerifier, codeChallenge, state } = generatePKCE();
    expect(codeVerifier).toBeTruthy();
    expect(codeChallenge).toBeTruthy();
    expect(state).toBeTruthy();
  });
});
