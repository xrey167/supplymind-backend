/**
 * Generate a dev-mode JWT (unsigned) that the auth middleware accepts when
 * CLERK_SECRET_KEY is not set. The middleware calls decodeJwtPayload() which
 * only base64-decodes the payload — no signature verification.
 */
export function makeJwt(sub: string, role: string = 'admin'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    role,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `${header}.${payload}.unsigned`;
}

export function authHeader(sub: string, role: string = 'admin'): Record<string, string> {
  return { Authorization: `Bearer ${makeJwt(sub, role)}` };
}
