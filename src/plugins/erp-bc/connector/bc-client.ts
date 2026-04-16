// src/plugins/erp-bc/connector/bc-client.ts

import { classifyHttpError, ConflictError, PermanentError } from '../sync/sync-errors';
import { getToken } from './bc-auth';
import type { TokenCache } from './bc-auth';
import { SYSTEM_FIELDS } from './bc-types';
import type { BcConnectionConfig, ODataResponse, BcEntityType, BcEntityMap } from './bc-types';

export class BcClient {
  constructor(
    private config: BcConnectionConfig,
    private tokenCache: TokenCache,
  ) {
    if (!/^https:\/\//.test(config.baseUrl)) {
      throw new PermanentError(`Invalid baseUrl — must use HTTPS: ${config.baseUrl}`);
    }
  }

  private baseEntityUrl(entitySet: BcEntityType): string {
    return `${this.config.baseUrl}/companies(${this.config.companyId})/${entitySet}`;
  }

  private async authHeaders(forceRefresh = false): Promise<Record<string, string>> {
    const token = await getToken(
      this.config.tenantId,
      this.config.clientId,
      this.config.clientSecret,
      this.tokenCache,
      forceRefresh,
    );
    return { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };
  }

  private async request<T>(url: string, init: RequestInit, attempt = 0): Promise<T> {
    const headers = await this.authHeaders(attempt > 0);
    // Strip Authorization from caller headers so refreshed token is never overwritten
    const { Authorization: _, ...callerHeaders } = ((init.headers ?? {}) as Record<string, string>);
    const res = await fetch(url, { ...init, headers: { ...headers, ...callerHeaders } });

    if (res.status === 401 && attempt === 0) {
      // One auto-retry with forced token refresh
      return this.request<T>(url, init, 1);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw classifyHttpError(res.status, body, res.headers.get('Retry-After'));
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  async list<K extends BcEntityType>(
    entitySet: K,
    opts: { filter?: string; top?: number; skipToken?: string; orderby?: string } = {},
  ): Promise<ODataResponse<BcEntityMap[K]>> {
    const url = new URL(this.baseEntityUrl(entitySet));
    if (opts.filter) url.searchParams.set('$filter', opts.filter);
    if (opts.top) url.searchParams.set('$top', String(opts.top));
    if (opts.skipToken) url.searchParams.set('$skiptoken', opts.skipToken);
    if (opts.orderby) url.searchParams.set('$orderby', opts.orderby);
    return this.request<ODataResponse<BcEntityMap[K]>>(url.toString(), { method: 'GET' });
  }

  async get<K extends BcEntityType>(
    entitySet: K,
    id: string,
  ): Promise<BcEntityMap[K]> {
    if (!/^[\w\-]+$/.test(id)) throw new PermanentError(`Invalid entity id: ${id}`);
    const url = `${this.baseEntityUrl(entitySet)}(${id})`;
    return this.request<BcEntityMap[K]>(url, { method: 'GET' });
  }

  async post<K extends BcEntityType>(
    entitySet: K,
    body: Partial<BcEntityMap[K]>,
  ): Promise<BcEntityMap[K]> {
    return this.request<BcEntityMap[K]>(
      this.baseEntityUrl(entitySet),
      { method: 'POST', body: JSON.stringify(body) },
    );
  }

  async patch<K extends BcEntityType>(
    entitySet: K,
    id: string,
    etag: string,
    body: Partial<BcEntityMap[K]>,
    mergeAttempt = 0,
  ): Promise<BcEntityMap[K]> {
    if (!/^[\w\-]+$/.test(id)) throw new PermanentError(`Invalid entity id: ${id}`);
    try {
      return await this.request<BcEntityMap[K]>(
        `${this.baseEntityUrl(entitySet)}(${id})`,
        { method: 'PATCH', body: JSON.stringify(body), headers: { 'If-Match': etag } },
      );
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
      if (mergeAttempt >= 3) throw new PermanentError(`Conflict unresolvable after 3 merge attempts on ${entitySet}(${id})`);
      // Fetch current server state with fresh ETag
      const current = await this.get(entitySet, id);
      const currentEtag = (current as unknown as Record<string, unknown>)['@odata.etag'] as string ?? '*';
      const systemFields = SYSTEM_FIELDS[entitySet];
      // Build merged body: overlay our non-system changes onto server state
      const merged: Partial<BcEntityMap[K]> = {};
      for (const [key, value] of Object.entries(body)) {
        if (!systemFields.has(key)) {
          (merged as Record<string, unknown>)[key] = value;
        }
      }
      return this.patch(entitySet, id, currentEtag, merged, mergeAttempt + 1);
    }
  }

  async action(entitySet: BcEntityType, id: string, actionName: string, payload?: unknown): Promise<void> {
    if (!/^[\w\-]+$/.test(id)) throw new PermanentError(`Invalid entity id: ${id}`);
    if (!/^[\w]+$/.test(actionName)) throw new PermanentError(`Invalid action name: ${actionName}`);
    const url = `${this.baseEntityUrl(entitySet)}(${id})/Microsoft.NAV.${actionName}`;
    await this.request<void>(url, { method: 'POST', body: JSON.stringify(payload ?? {}) });
  }
}
