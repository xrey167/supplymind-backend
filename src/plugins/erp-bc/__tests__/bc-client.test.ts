import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { BcClient } from '../connector/bc-client';
import type { TokenCache } from '../connector/bc-auth';
import { PermanentError, TransientError } from '../sync/sync-errors';

// Mock global fetch
let mockFetchImpl: (url: string, init?: any) => Promise<Response>;
globalThis.fetch = (...args: any[]) => mockFetchImpl(...args) as any;

const mockCache: TokenCache = {
  get: async () => JSON.stringify({ accessToken: 'test-token', expiresAt: Date.now() + 3600_000 }),
  set: async () => {},
};

const config = {
  tenantId: 'tenant-1',
  clientId: 'client-1',
  clientSecret: 'secret',
  baseUrl: 'https://api.bc.test/v2.0/tenant-1/Production/ODataV4',
  companyId: 'company-1',
};

function makeClient() { return new BcClient(config, mockCache); }

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('BcClient', () => {
  it('list returns OData response value array', async () => {
    mockFetchImpl = async () => jsonResponse({ value: [{ id: 'po-1', number: 'PO001' }] });
    const result = await makeClient().list('purchaseOrders');
    expect(result.value).toHaveLength(1);
    expect(result.value[0].id).toBe('po-1');
  });

  it('get returns single entity', async () => {
    mockFetchImpl = async () => jsonResponse({ id: 'v-1', displayName: 'Acme Corp' });
    const result = await makeClient().get('vendors', 'v-1');
    expect(result.id).toBe('v-1');
  });

  it('retries once on 401 with force-refresh', async () => {
    let bcCalls = 0;
    mockFetchImpl = async (url: string) => {
      // Azure AD token endpoint — return a mock token
      if (url.includes('login.microsoftonline.com')) {
        return new Response(
          JSON.stringify({ access_token: 'refreshed-token', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      bcCalls++;
      if (bcCalls === 1) return new Response('Unauthorized', { status: 401 });
      return jsonResponse({ value: [] });
    };
    const result = await makeClient().list('vendors');
    expect(result.value).toEqual([]);
    expect(bcCalls).toBe(2);
  });

  it('throws PermanentError on 400', async () => {
    mockFetchImpl = async () => new Response('bad request', { status: 400 });
    try {
      await makeClient().list('vendors');
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(PermanentError);
    }
  });

  it('throws TransientError on 500', async () => {
    mockFetchImpl = async () => new Response('server error', { status: 500 });
    try {
      await makeClient().list('vendors');
    } catch (e) {
      expect(e).toBeInstanceOf(TransientError);
    }
  });
});
