import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

function deriveKey(workspaceId: string): Buffer {
  const masterKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!masterKey) throw new Error('CREDENTIALS_ENCRYPTION_KEY env var is not set');
  return createHash('sha256').update(masterKey + workspaceId).digest();
}

export function encrypt(plaintext: string, workspaceId: string): { encrypted: string; iv: string; tag: string } {
  const key = deriveKey(workspaceId);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decrypt(encrypted: string, iv: string, tag: string, workspaceId: string): string {
  const key = deriveKey(workspaceId);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
