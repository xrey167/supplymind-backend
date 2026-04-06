/** Decode a JWT payload without verification. INSECURE — dev/debug use only. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
}

/** Check whether a JWT payload has expired (based on `exp` claim). */
export function isExpired(payload: { exp?: number }): boolean {
  if (!payload.exp) return false;
  return Date.now() / 1000 > payload.exp;
}
