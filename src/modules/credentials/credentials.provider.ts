/**
 * AES-256-GCM encryption for workspace credentials.
 *
 * Key derivation: HKDF-SHA256 with the master key as input keying material,
 * workspaceId as salt (domain separation), and "credentials" as info context.
 * This ensures each workspace gets a unique derived key.
 *
 * IMPORTANT: Rotating CREDENTIALS_ENCRYPTION_KEY requires re-encrypting all
 * existing credentials. There is no key versioning — if the key changes,
 * existing ciphertexts become unrecoverable.
 *
 * Parameters: 12-byte random IV, 16-byte auth tag (GCM default).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

function deriveKey(workspaceId: string): Buffer {
  const masterKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!masterKey) throw new Error('CREDENTIALS_ENCRYPTION_KEY env var is not set');
  return Buffer.from(hkdfSync('sha256', masterKey, workspaceId, 'credentials', 32));
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
  try {
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new Error(`Failed to decrypt credential for workspace ${workspaceId}: ${err instanceof Error ? err.message : err}`);
  }
}
