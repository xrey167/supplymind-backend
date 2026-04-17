import type { OAuthProvider, TokenSet } from '../types';

export const cursorProvider: OAuthProvider = {
  id: 'cursor',
  displayName: 'Cursor',
  flowType: 'token_import',
  supportsRefresh: false,

  async normalizeImportedToken(accessToken: string): Promise<TokenSet> {
    const parts = accessToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid Cursor token: expected JWT format');
    }

    let email: string | undefined;
    let displayName: string | undefined;
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      email = payload.email ?? payload.sub;
      displayName = payload.name ?? payload.username;
    } catch { /* non-fatal — token is structurally valid, claims are best-effort */ }

    return {
      accessToken,
      email,
      displayName,
      providerData: { authMethod: 'imported' },
    };
  },
};
