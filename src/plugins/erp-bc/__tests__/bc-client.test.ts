import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { BcClient } from '../connector/bc-client';
import type { TokenCache } from '../connector/bc-auth';
import { PermanentError, TransientError } from '../sync/sync-errors';

// Mock global fetch
let mockFetchImpl: (url: string, init?: any) => Promise<Response>;
globalThis.fetch = ((url: string, init?: any) => mockFetchImpl(url, init)) as typeof fetch;

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

  describe('patch() conflict merge-retry', () => {
    it('on 409 fetches fresh ETag and retries with merged body (system fields stripped)', async () => {
      const capturedRequests: Array<{ url: string; init: RequestInit }> = [];

      mockFetchImpl = async (url: string, init?: RequestInit) => {
        capturedRequests.push({ url, init: init ?? {} });

        // Azure AD token endpoint
        if (url.includes('login.microsoftonline.com')) {
          return new Response(
            JSON.stringify({ access_token: 'test-token', expires_in: 3600 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const method = (init?.method ?? 'GET').toUpperCase();

        // First PATCH → 409
        if (method === 'PATCH' && capturedRequests.filter(r => (r.init.method ?? 'GET').toUpperCase() === 'PATCH').length === 1) {
          return new Response('ETag mismatch', { status: 409 });
        }

        // GET (re-fetch for fresh ETag) → 200
        if (method === 'GET') {
          return jsonResponse({
            id: 'po-1',
            '@odata.etag': '"new-etag"',
            lastModifiedDateTime: '2026-04-14T00:00:00Z',
            number: 'PO001',
            status: 'Open',
            vendorId: 'v-1',
            vendorNumber: 'V001',
            orderDate: '2026-04-01',
            totalAmountIncludingTax: 1000,
            currencyCode: 'USD',
          });
        }

        // Second PATCH → 200
        return jsonResponse({
          id: 'po-1',
          '@odata.etag': '"new-etag"',
          lastModifiedDateTime: '2026-04-14T00:01:00Z',
          number: 'PO001',
          status: 'Open',
          vendorId: 'v-1',
          vendorNumber: 'V001',
          orderDate: '2026-04-14',
          totalAmountIncludingTax: 2000,
          currencyCode: 'USD',
        });
      };

      // Attempt to patch with body that includes system fields + editable fields
      const result = await makeClient().patch(
        'purchaseOrders',
        'po-1',
        '"stale-etag"',
        {
          id: 'po-1',                         // system field — must be stripped
          '@odata.etag': '"stale-etag"',       // system field — must be stripped
          lastModifiedDateTime: '2026-01-01',  // system field — must be stripped
          number: 'PO001',                     // system field — must be stripped
          status: 'Open',                      // system field — must be stripped
          vendorId: 'v-1',                     // editable — must be kept
          orderDate: '2026-04-14',             // editable — must be kept
          totalAmountIncludingTax: 2000,       // editable — must be kept
        } as any,
      );

      expect(result).toBeDefined();

      // Find PATCH requests (excluding Azure AD token calls)
      const patchRequests = capturedRequests.filter(r => (r.init.method ?? 'GET').toUpperCase() === 'PATCH');
      expect(patchRequests).toHaveLength(2);

      // Second PATCH must use fresh ETag
      const secondPatchHeaders = patchRequests[1].init.headers as Record<string, string>;
      expect(secondPatchHeaders['If-Match']).toBe('"new-etag"');

      // Second PATCH body must NOT contain system fields
      const secondPatchBody = JSON.parse(patchRequests[1].init.body as string);
      expect(secondPatchBody).not.toHaveProperty('id');
      expect(secondPatchBody).not.toHaveProperty('@odata.etag');
      expect(secondPatchBody).not.toHaveProperty('lastModifiedDateTime');
      expect(secondPatchBody).not.toHaveProperty('number');
      expect(secondPatchBody).not.toHaveProperty('status');

      // Second PATCH body must contain editable fields
      expect(secondPatchBody.vendorId).toBe('v-1');
      expect(secondPatchBody.orderDate).toBe('2026-04-14');
      expect(secondPatchBody.totalAmountIncludingTax).toBe(2000);
    });

    it('throws PermanentError after 3 consecutive 409 responses', async () => {
      mockFetchImpl = async (url: string, init?: RequestInit) => {
        if (url.includes('login.microsoftonline.com')) {
          return new Response(
            JSON.stringify({ access_token: 'test-token', expires_in: 3600 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const method = (init?.method ?? 'GET').toUpperCase();

        if (method === 'PATCH') {
          return new Response('ETag mismatch', { status: 409 });
        }

        // GET always returns fresh (but it keeps conflicting because every PATCH fails)
        return jsonResponse({
          id: 'v-1',
          '@odata.etag': '"fresh-etag"',
          lastModifiedDateTime: '2026-04-14T00:00:00Z',
          number: 'V001',
          displayName: 'Acme',
          email: null,
          currencyCode: 'USD',
          blocked: '',
        });
      };

      let caught: unknown;
      try {
        await makeClient().patch('vendors', 'v-1', '"old-etag"', { displayName: 'Updated' } as any);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(PermanentError);
      expect((caught as PermanentError).message).toContain('vendors');
      expect((caught as PermanentError).message).toContain('v-1');
    });

    it('propagates non-409 errors without retrying (no GET called)', async () => {
      let getCalled = false;

      mockFetchImpl = async (url: string, init?: RequestInit) => {
        if (url.includes('login.microsoftonline.com')) {
          return new Response(
            JSON.stringify({ access_token: 'test-token', expires_in: 3600 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const method = (init?.method ?? 'GET').toUpperCase();

        if (method === 'GET') {
          getCalled = true;
          return jsonResponse({ id: 'v-1' });
        }

        // PATCH returns 400 (permanent, not conflict)
        return new Response('bad request', { status: 400 });
      };

      let caught: unknown;
      try {
        await makeClient().patch('vendors', 'v-1', '"etag"', { displayName: 'X' } as any);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(PermanentError);
      expect(getCalled).toBe(false);
    });
  });
});
