import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getProvider, listProviders } from '../../infra/oauth/registry';
import { generatePKCE } from '../../infra/oauth/pkce';
import { oauthConnectionsService } from './oauth-connections.service';
import { exchangeCodeSchema, pollTokenSchema, importTokenSchema } from './oauth-connections.schemas';
import type { OAuthProvider } from './oauth-connections.types';

export const oauthConnectionsRoutes = new Hono();

/** GET /oauth/providers — list all supported OAuth providers */
oauthConnectionsRoutes.get('/providers', (c) => {
  const providers = listProviders().map(p => ({
    id: p.id,
    displayName: p.displayName,
    flowType: p.flowType,
  }));
  return c.json({ providers });
});

/** GET /oauth/:provider/authorize — generate auth URL + PKCE data */
oauthConnectionsRoutes.get('/:provider/authorize', (c) => {
  const { provider } = c.req.param();
  const redirectUri = c.req.query('redirect_uri') ?? 'http://localhost:3001/api/oauth/callback';

  const p = getProvider(provider);
  if (p.flowType !== 'authorization_code_pkce') {
    return c.json({ error: `Provider ${provider} does not use authorization_code_pkce flow` }, 400);
  }

  const { codeVerifier, codeChallenge, state } = generatePKCE();
  const authUrl = p.buildAuthUrl!({ redirectUri, state, codeChallenge });

  // Return codeVerifier to client — client must store it (session/localStorage) and send back on exchange
  return c.json({ authUrl, state, codeVerifier, redirectUri });
});

/** POST /oauth/:provider/:workspaceId/exchange — exchange code for tokens */
oauthConnectionsRoutes.post(
  '/:provider/:workspaceId/exchange',
  zValidator('json', exchangeCodeSchema),
  async (c) => {
    const { provider, workspaceId } = c.req.param();
    const body = c.req.valid('json');

    const p = getProvider(provider);
    if (!p.exchangeCode) {
      return c.json({ error: `Provider ${provider} does not support code exchange` }, 400);
    }

    const tokens = await p.exchangeCode({
      code: body.code,
      redirectUri: body.redirectUri,
      codeVerifier: body.codeVerifier,
      state: body.state,
    });

    const result = await oauthConnectionsService.storeTokens({
      workspaceId,
      provider: provider as OAuthProvider,
      ...tokens,
    });

    if (!result.ok) return c.json({ error: result.error.message }, 500);
    return c.json({ success: true, connectionId: result.value.id });
  },
);

/** GET /oauth/:provider/device-code — initiate device code flow */
oauthConnectionsRoutes.get('/:provider/device-code', async (c) => {
  const { provider } = c.req.param();
  const p = getProvider(provider);

  if (p.flowType !== 'device_code' || !p.requestDeviceCode) {
    return c.json({ error: `Provider ${provider} does not support device_code flow` }, 400);
  }

  const deviceData = await p.requestDeviceCode();
  return c.json(deviceData);
});

/** POST /oauth/:provider/:workspaceId/poll — poll for token (device code) */
oauthConnectionsRoutes.post(
  '/:provider/:workspaceId/poll',
  zValidator('json', pollTokenSchema),
  async (c) => {
    const { provider, workspaceId } = c.req.param();
    const { deviceCode, extraData } = c.req.valid('json');

    const p = getProvider(provider);
    if (!p.pollToken) {
      return c.json({ error: `Provider ${provider} does not support token polling` }, 400);
    }

    const result = await p.pollToken(deviceCode, extraData);

    if (result.pending) return c.json({ success: false, pending: true });
    if (!result.success || !result.tokens) {
      return c.json({ success: false, error: result.error, errorDescription: result.errorDescription });
    }

    const stored = await oauthConnectionsService.storeTokens({
      workspaceId,
      provider: provider as OAuthProvider,
      ...result.tokens,
    });

    if (!stored.ok) return c.json({ error: stored.error.message }, 500);
    return c.json({ success: true, connectionId: stored.value.id });
  },
);

/** POST /oauth/:provider/:workspaceId/import — import a manually provided token (token_import flow) */
oauthConnectionsRoutes.post(
  '/:provider/:workspaceId/import',
  zValidator('json', importTokenSchema),
  async (c) => {
    const { provider, workspaceId } = c.req.param();
    const { accessToken } = c.req.valid('json');

    const p = getProvider(provider);
    if (p.flowType !== 'token_import' || !p.normalizeImportedToken) {
      return c.json({ error: `Provider ${provider} does not support token import` }, 400);
    }

    const tokens = await p.normalizeImportedToken(accessToken);
    const result = await oauthConnectionsService.storeTokens({
      workspaceId,
      provider: provider as OAuthProvider,
      ...tokens,
    });

    if (!result.ok) return c.json({ error: result.error.message }, 500);
    return c.json({ success: true, connectionId: result.value.id });
  },
);

/** GET /oauth/:workspaceId/connections — list all connections for workspace */
oauthConnectionsRoutes.get('/:workspaceId/connections', async (c) => {
  const { workspaceId } = c.req.param();
  const connections = await oauthConnectionsService.listConnections(workspaceId);
  return c.json({ connections });
});

/** DELETE /oauth/:workspaceId/connections/:id — disconnect */
oauthConnectionsRoutes.delete('/:workspaceId/connections/:id', async (c) => {
  const { id } = c.req.param();
  const deleted = await oauthConnectionsService.disconnect(id);
  return c.json({ success: deleted });
});
