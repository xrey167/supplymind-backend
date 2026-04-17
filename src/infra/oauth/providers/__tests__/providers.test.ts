/**
 * Unit tests for 7 new OAuth provider implementations.
 * Runtime: Bun — uses bun:test.
 *
 * Fetch is mocked globally before any provider module is imported so that
 * no real network calls are made during the test run.
 */
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// ---------------------------------------------------------------------------
// Global fetch mock — must be set before providers are imported
// ---------------------------------------------------------------------------
const fetchMock = mock(() =>
  Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
);
global.fetch = fetchMock as unknown as typeof fetch;

// ---------------------------------------------------------------------------
// Patch Bun.sleep so antigravity's onboarding poll loop resolves immediately
// ---------------------------------------------------------------------------
const originalSleep = Bun.sleep;
(Bun as unknown as Record<string, unknown>).sleep = () => Promise.resolve();

afterAll(() => {
  (Bun as unknown as Record<string, unknown>).sleep = originalSleep;
});

// ---------------------------------------------------------------------------
// Provider imports (after global.fetch is replaced)
// ---------------------------------------------------------------------------
import { codexProvider } from '../codex';
import { kiroProvider } from '../kiro';
import { kilocodeProvider } from '../kilocode';
import { clineProvider } from '../cline';
import { kimiCodingProvider } from '../kimi-coding';
import { cursorProvider } from '../cursor';
import { antigravityProvider } from '../antigravity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal base64url-encoded JWT: header.payload.sig */
function makeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.sig`;
}

/** Returns a Response whose .json() resolves to `body` */
function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Returns a queue-based mock: each call to fetchMock pops the next response */
function queueResponses(...responses: Response[]) {
  const queue = [...responses];
  fetchMock.mockImplementation(() => {
    const next = queue.shift();
    if (!next) throw new Error('fetch called more times than expected');
    return Promise.resolve(next);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
});

// ===========================================================================
// codex — authorization_code_pkce
// ===========================================================================
describe('codexProvider', () => {
  it('has correct metadata', () => {
    expect(codexProvider.id).toBe('codex');
    expect(codexProvider.flowType).toBe('authorization_code_pkce');
    expect(typeof codexProvider.buildAuthUrl).toBe('function');
    expect(typeof codexProvider.exchangeCode).toBe('function');
  });

  it('buildAuthUrl contains auth.openai.com and required params', () => {
    const url = codexProvider.buildAuthUrl!({
      redirectUri: 'https://example.com/cb',
      state: 'st123',
      codeChallenge: 'challenge_abc',
    });
    expect(url).toContain('auth.openai.com');
    expect(url).toContain('state=st123');
    expect(url).toContain('code_challenge=challenge_abc');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('id_token_add_organizations=true');
  });

  it('exchangeCode parses id_token and returns org providerData', async () => {
    const idTokenPayload = {
      email: 'user@openai.com',
      name: 'Test User',
      'https://api.openai.com/auth': {
        user_id: 'u_123',
        organizations: [
          { id: 'org_abc', name: 'My Org', is_default: true, plan_type: 'team' },
        ],
      },
    };
    const idToken = makeJwt(idTokenPayload);

    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          access_token: 'at_codex',
          refresh_token: 'rt_codex',
          expires_in: 3600,
          id_token: idToken,
        }),
      ),
    );

    const tokens = await codexProvider.exchangeCode!({
      code: 'auth_code',
      redirectUri: 'https://example.com/cb',
      codeVerifier: 'verifier',
    });

    expect(tokens.accessToken).toBe('at_codex');
    expect(tokens.refreshToken).toBe('rt_codex');
    expect(tokens.email).toBe('user@openai.com');
    expect(tokens.displayName).toBe('Test User');
    expect(tokens.providerData?.workspaceId).toBe('org_abc');
    expect(tokens.providerData?.chatgptUserId).toBe('u_123');
  });

  it('exchangeCode throws when token endpoint returns non-OK', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('Unauthorized', { status: 401 })),
    );

    await expect(
      codexProvider.exchangeCode!({
        code: 'bad_code',
        redirectUri: 'https://example.com/cb',
        codeVerifier: 'verifier',
      }),
    ).rejects.toThrow('Codex token exchange failed');
  });

  it('exchangeCode handles missing id_token gracefully', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ access_token: 'at_no_id', expires_in: 3600 })),
    );

    const tokens = await codexProvider.exchangeCode!({
      code: 'code',
      redirectUri: 'https://example.com/cb',
      codeVerifier: 'verifier',
    });

    expect(tokens.accessToken).toBe('at_no_id');
    expect(tokens.email).toBeUndefined();
    expect(tokens.providerData).toBeUndefined();
  });
});

// ===========================================================================
// kiro — device_code (AWS Builder ID / OIDC)
// ===========================================================================
describe('kiroProvider', () => {
  it('has correct metadata', () => {
    expect(kiroProvider.id).toBe('kiro');
    expect(kiroProvider.flowType).toBe('device_code');
    expect(kiroProvider.supportsRefresh).toBe(true);
  });

  it('requestDeviceCode makes 2 fetch calls and returns extraData with clientId/clientSecret', async () => {
    queueResponses(
      // 1st call: client registration
      jsonResponse({ clientId: 'cid_kiro', clientSecret: 'csec_kiro' }),
      // 2nd call: device_authorization
      jsonResponse({
        deviceCode: 'dc_kiro',
        userCode: 'ABCD-1234',
        verificationUri: 'https://view.awsapps.com/start',
        interval: 5,
        expiresIn: 600,
      }),
    );

    const result = await kiroProvider.requestDeviceCode!();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.deviceCode).toBe('dc_kiro');
    expect(result.userCode).toBe('ABCD-1234');
    expect(result.verificationUrl).toBe('https://view.awsapps.com/start');
    expect(result.extraData?.clientId).toBe('cid_kiro');
    expect(result.extraData?.clientSecret).toBe('csec_kiro');
  });

  it('requestDeviceCode throws when registration fails', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('Server error', { status: 500 })),
    );

    await expect(kiroProvider.requestDeviceCode!()).rejects.toThrow(
      'Kiro client registration failed',
    );
  });

  it('pollToken returns success with tokens including email from id_token', async () => {
    const idToken = makeJwt({ email: 'kiro@example.com', sub: 'u_kiro' });

    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          access_token: 'at_kiro',
          refresh_token: 'rt_kiro',
          expires_in: 900,
          id_token: idToken,
        }),
      ),
    );

    const result = await kiroProvider.pollToken!('dc_kiro', {
      clientId: 'cid_kiro',
      clientSecret: 'csec_kiro',
    });

    expect(result.success).toBe(true);
    expect(result.tokens?.accessToken).toBe('at_kiro');
    expect(result.tokens?.email).toBe('kiro@example.com');
    expect(result.tokens?.providerData?.clientId).toBe('cid_kiro');
  });

  it('pollToken returns pending when AWS returns authorization_pending', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ error: 'authorization_pending' }, 400),
      ),
    );

    const result = await kiroProvider.pollToken!('dc_kiro', {
      clientId: 'cid',
      clientSecret: 'csec',
    });

    expect(result.success).toBe(false);
    expect(result.pending).toBe(true);
    expect(result.error).toBe('authorization_pending');
  });

  it('pollToken returns error for non-pending failures', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ error: 'expired_token', error_description: 'Token expired' }, 400),
      ),
    );

    const result = await kiroProvider.pollToken!('dc_kiro', {
      clientId: 'cid',
      clientSecret: 'csec',
    });

    expect(result.success).toBe(false);
    expect(result.pending).toBeUndefined();
    expect(result.error).toBe('expired_token');
  });
});

// ===========================================================================
// kilocode — device_code
// ===========================================================================
describe('kilocodeProvider', () => {
  it('has correct metadata', () => {
    expect(kilocodeProvider.id).toBe('kilocode');
    expect(kilocodeProvider.flowType).toBe('device_code');
    expect(kilocodeProvider.supportsRefresh).toBe(false);
  });

  it('requestDeviceCode returns device code response', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          device_code: 'dc_kilo',
          user_code: 'KILO-9999',
          verification_uri: 'https://auth.kilo.ai/activate',
          interval: 5,
          expires_in: 300,
        }),
      ),
    );

    const result = await kilocodeProvider.requestDeviceCode!();

    expect(result.deviceCode).toBe('dc_kilo');
    expect(result.userCode).toBe('KILO-9999');
    expect(result.verificationUrl).toBe('https://auth.kilo.ai/activate');
    expect(result.expiresIn).toBe(300);
  });

  it('requestDeviceCode throws when endpoint returns non-OK', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('error', { status: 500 })),
    );

    await expect(kilocodeProvider.requestDeviceCode!()).rejects.toThrow(
      'Kilocode device code request failed',
    );
  });

  it('pollToken returns success on HTTP 200 with access_token', async () => {
    const idToken = makeJwt({ email: 'kilo@example.com' });

    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          access_token: 'at_kilo',
          expires_in: 3600,
          scope: 'openid profile email',
          id_token: idToken,
        }),
      ),
    );

    const result = await kilocodeProvider.pollToken!('dc_kilo');

    expect(result.success).toBe(true);
    expect(result.tokens?.accessToken).toBe('at_kilo');
    expect(result.tokens?.email).toBe('kilo@example.com');
  });

  it('pollToken returns pending on HTTP 202', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('', { status: 202 })),
    );

    const result = await kilocodeProvider.pollToken!('dc_kilo');

    expect(result.success).toBe(false);
    expect(result.pending).toBe(true);
  });

  it('pollToken returns access_denied on HTTP 403 (does not throw)', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('', { status: 403 })),
    );

    const result = await kilocodeProvider.pollToken!('dc_kilo');

    expect(result.success).toBe(false);
    expect(result.error).toBe('access_denied');
  });

  it('pollToken returns expired_token on HTTP 410', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('', { status: 410 })),
    );

    const result = await kilocodeProvider.pollToken!('dc_kilo');

    expect(result.success).toBe(false);
    expect(result.error).toBe('expired_token');
  });
});

// ===========================================================================
// cline — authorization_code_pkce (with base64url JSON shortcut)
// ===========================================================================
describe('clineProvider', () => {
  it('has correct metadata', () => {
    expect(clineProvider.id).toBe('cline');
    expect(clineProvider.flowType).toBe('authorization_code_pkce');
    expect(clineProvider.supportsRefresh).toBe(false);
  });

  it('buildAuthUrl contains app.cline.bot and required params', () => {
    const url = clineProvider.buildAuthUrl!({
      redirectUri: 'https://example.com/cb',
      state: 'st_cline',
      codeChallenge: 'chal_cline',
    });
    expect(url).toContain('app.cline.bot');
    expect(url).toContain('state=st_cline');
    expect(url).toContain('code_challenge=chal_cline');
    expect(url).toContain('code_challenge_method=S256');
  });

  it('exchangeCode decodes base64url JSON access_token WITHOUT fetch', async () => {
    const payload = {
      access_token: 'at_from_b64',
      refresh_token: 'rt_from_b64',
      expires_in: 3600,
      email: 'cline@example.com',
      scope: 'openid',
    };
    const code = Buffer.from(JSON.stringify(payload)).toString('base64url');

    const tokens = await clineProvider.exchangeCode!({
      code,
      redirectUri: 'https://example.com/cb',
      codeVerifier: 'verifier',
    });

    // fetch must not have been called
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tokens.accessToken).toBe('at_from_b64');
    expect(tokens.refreshToken).toBe('rt_from_b64');
    expect(tokens.email).toBe('cline@example.com');
  });

  it('exchangeCode falls back to HTTP when code is a plain string (not base64 JSON)', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          access_token: 'at_http_cline',
          refresh_token: 'rt_http_cline',
          expires_in: 7200,
          email: 'http@cline.bot',
          scope: 'openid',
        }),
      ),
    );

    const tokens = await clineProvider.exchangeCode!({
      code: 'plain-code-no-json',
      redirectUri: 'https://example.com/cb',
      codeVerifier: 'verifier',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tokens.accessToken).toBe('at_http_cline');
    expect(tokens.email).toBe('http@cline.bot');
  });

  it('exchangeCode HTTP fallback throws on non-OK response', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('Bad Request', { status: 400 })),
    );

    await expect(
      clineProvider.exchangeCode!({
        code: 'plain-code',
        redirectUri: 'https://example.com/cb',
        codeVerifier: 'verifier',
      }),
    ).rejects.toThrow('Cline token exchange failed');
  });
});

// ===========================================================================
// kimi-coding — device_code (Moonshot AI)
// ===========================================================================
describe('kimiCodingProvider', () => {
  it('has correct metadata', () => {
    expect(kimiCodingProvider.id).toBe('kimi-coding');
    expect(kimiCodingProvider.flowType).toBe('device_code');
    expect(kimiCodingProvider.supportsRefresh).toBe(true);
  });

  it('requestDeviceCode sends X-Msh-* headers and returns device code response', async () => {
    let capturedHeaders: Record<string, string> = {};

    fetchMock.mockImplementation((url, init) => {
      capturedHeaders = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      );
      return Promise.resolve(
        jsonResponse({
          device_code: 'dc_kimi',
          user_code: 'KIMI-XXXX',
          verification_uri: 'https://kimi.moonshot.cn/activate',
          interval: 5,
          expires_in: 600,
        }),
      );
    });

    const result = await kimiCodingProvider.requestDeviceCode!();

    expect(result.deviceCode).toBe('dc_kimi');
    expect(result.userCode).toBe('KIMI-XXXX');
    expect(capturedHeaders['x-msh-platform']).toBe('web');
    expect(capturedHeaders['x-msh-version']).toBe('1.0.0');
    expect(capturedHeaders['x-msh-device-id']).toBeTruthy();
  });

  it('requestDeviceCode throws on non-OK response', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('error', { status: 500 })),
    );

    await expect(kimiCodingProvider.requestDeviceCode!()).rejects.toThrow(
      'Kimi device code request failed',
    );
  });

  it('pollToken returns success with access_token', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          access_token: 'at_kimi',
          refresh_token: 'rt_kimi',
          expires_in: 3600,
          scope: 'user',
          email: 'kimi@moonshot.cn',
        }),
      ),
    );

    const result = await kimiCodingProvider.pollToken!('dc_kimi');

    expect(result.success).toBe(true);
    expect(result.tokens?.accessToken).toBe('at_kimi');
    expect(result.tokens?.email).toBe('kimi@moonshot.cn');
  });

  it('pollToken returns pending when authorization_pending error in body', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: 'authorization_pending' })),
    );

    const result = await kimiCodingProvider.pollToken!('dc_kimi');

    expect(result.success).toBe(false);
    expect(result.pending).toBe(true);
  });

  it('pollToken returns error on non-OK HTTP status', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('error', { status: 500 })),
    );

    const result = await kimiCodingProvider.pollToken!('dc_kimi');

    expect(result.success).toBe(false);
    expect(result.error).toBe('request_failed');
  });

  it('pollToken returns access_denied when body error is access_denied', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: 'access_denied' })),
    );

    const result = await kimiCodingProvider.pollToken!('dc_kimi');

    expect(result.success).toBe(false);
    expect(result.error).toBe('access_denied');
    expect(result.pending).toBeUndefined();
  });
});

// ===========================================================================
// cursor — token_import
// ===========================================================================
describe('cursorProvider', () => {
  it('has correct metadata', () => {
    expect(cursorProvider.id).toBe('cursor');
    expect(cursorProvider.flowType).toBe('token_import');
    expect(cursorProvider.supportsRefresh).toBe(false);
    expect(typeof cursorProvider.normalizeImportedToken).toBe('function');
  });

  it('normalizeImportedToken succeeds for valid JWT with email and name in payload', async () => {
    const token = makeJwt({ email: 'user@cursor.so', name: 'Cursor User', sub: 'u_cursor' });

    const tokens = await cursorProvider.normalizeImportedToken!(token);

    expect(tokens.accessToken).toBe(token);
    expect(tokens.email).toBe('user@cursor.so');
    expect(tokens.displayName).toBe('Cursor User');
    expect(tokens.providerData?.authMethod).toBe('imported');
  });

  it('normalizeImportedToken uses sub as email fallback when email missing', async () => {
    const token = makeJwt({ sub: 'sub_cursor_user' });

    const tokens = await cursorProvider.normalizeImportedToken!(token);

    expect(tokens.accessToken).toBe(token);
    expect(tokens.email).toBe('sub_cursor_user');
  });

  it('normalizeImportedToken throws for token with less than 3 parts', async () => {
    await expect(
      cursorProvider.normalizeImportedToken!('not.a.valid.jwt.extra'),
    ).rejects.toThrow('Invalid Cursor token: expected JWT format');
  });

  it('normalizeImportedToken throws for token without dots', async () => {
    await expect(
      cursorProvider.normalizeImportedToken!('notajwtatall'),
    ).rejects.toThrow('Invalid Cursor token: expected JWT format');
  });

  it('normalizeImportedToken succeeds for valid JWT even with non-JSON payload (best-effort claims)', async () => {
    // Part[1] is not valid base64 JSON — should succeed but with undefined email/displayName
    const token = 'header.!!!notbase64!!.sig';

    const tokens = await cursorProvider.normalizeImportedToken!(token);

    expect(tokens.accessToken).toBe(token);
    expect(tokens.email).toBeUndefined();
    expect(tokens.displayName).toBeUndefined();
  });
});

// ===========================================================================
// antigravity — authorization_code_pkce (Google Cloud Code)
// ===========================================================================
describe('antigravityProvider', () => {
  it('has correct metadata', () => {
    expect(antigravityProvider.id).toBe('antigravity');
    expect(antigravityProvider.flowType).toBe('authorization_code_pkce');
    expect(antigravityProvider.supportsRefresh).toBe(true);
  });

  it('buildAuthUrl contains accounts.google.com and required params', () => {
    const url = antigravityProvider.buildAuthUrl!({
      redirectUri: 'https://example.com/cb',
      state: 'st_ag',
      codeChallenge: 'chal_ag',
    });
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('state=st_ag');
    expect(url).toContain('code_challenge=chal_ag');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
  });

  it('exchangeCode calls Google token + onboard endpoints, returns TokenSet with projectId', async () => {
    const idToken = makeJwt({ email: 'user@google.com' });

    queueResponses(
      // 1st fetch: Google token endpoint
      jsonResponse({
        access_token: 'at_google',
        refresh_token: 'rt_google',
        expires_in: 3600,
        id_token: idToken,
      }),
      // 2nd fetch: Cloud Code onboard — synchronously done (status 200, done !== false)
      jsonResponse({
        done: true,
        metadata: { projectId: 'my-gcp-project' },
      }),
    );

    const tokens = await antigravityProvider.exchangeCode!({
      code: 'google_auth_code',
      redirectUri: 'https://example.com/cb',
      codeVerifier: 'verifier',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(tokens.accessToken).toBe('at_google');
    expect(tokens.refreshToken).toBe('rt_google');
    expect(tokens.email).toBe('user@google.com');
    expect(tokens.providerData?.projectId).toBe('my-gcp-project');
  });

  it('exchangeCode continues even when onboard endpoint returns 202 then resolves', async () => {
    const idToken = makeJwt({ email: 'user2@google.com' });

    queueResponses(
      // 1st: token exchange
      jsonResponse({
        access_token: 'at_google2',
        refresh_token: 'rt_google2',
        expires_in: 3600,
        id_token: idToken,
      }),
      // 2nd: onboard — still pending (202)
      new Response(JSON.stringify({ done: false }), { status: 202 }),
      // 3rd: poll — done
      jsonResponse({
        done: true,
        response: { name: 'projects/poll-project-id/workspaces/ws1' },
      }),
    );

    const tokens = await antigravityProvider.exchangeCode!({
      code: 'code2',
      redirectUri: 'https://example.com/cb',
      codeVerifier: 'verifier',
    });

    expect(tokens.accessToken).toBe('at_google2');
    expect(tokens.providerData?.projectId).toBe('poll-project-id');
  });

  it('exchangeCode throws when Google token exchange fails', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('Bad token', { status: 401 })),
    );

    await expect(
      antigravityProvider.exchangeCode!({
        code: 'bad_code',
        redirectUri: 'https://example.com/cb',
        codeVerifier: 'verifier',
      }),
    ).rejects.toThrow('Antigravity token exchange failed');
  });

  it('exchangeCode proceeds without projectId when onboard throws (non-fatal)', async () => {
    const idToken = makeJwt({ email: 'user3@google.com' });

    queueResponses(
      // 1st: token exchange success
      jsonResponse({
        access_token: 'at_google3',
        expires_in: 3600,
        id_token: idToken,
      }),
      // 2nd: onboard throws (simulated network error via bad JSON causing parse failure)
      new Response('not-json', { status: 200 }),
    );

    const tokens = await antigravityProvider.exchangeCode!({
      code: 'code3',
      redirectUri: 'https://example.com/cb',
      codeVerifier: 'verifier',
    });

    expect(tokens.accessToken).toBe('at_google3');
    // projectId should be undefined since onboard failed non-fatally
    expect(tokens.providerData?.projectId).toBeUndefined();
  });
});
