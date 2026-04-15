import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { credentialsRepo } from './credentials.repo';
import { encrypt, decrypt } from './credentials.provider';
import { logger } from '../../config/logger';
import type { Credential, CreateCredentialInput, UpdateCredentialInput } from './credentials.types';

export class CredentialsService {
  async create(input: CreateCredentialInput): Promise<Result<Credential>> {
    const { encrypted, iv, tag } = encrypt(input.value, input.workspaceId);
    const credential = await credentialsRepo.createCredential({
      workspaceId: input.workspaceId,
      name: input.name,
      provider: input.provider,
      encryptedValue: encrypted,
      iv,
      tag,
      metadata: input.metadata ?? {},
    });
    eventBus.publish(Topics.CREDENTIAL_CREATED, {
      credentialId: credential.id,
      workspaceId: credential.workspaceId,
      name: credential.name,
      provider: credential.provider,
    }).catch((err: unknown) => logger.error({ err, credentialId: credential.id }, 'Failed to publish CREDENTIAL_CREATED event'));
    return ok(credential);
  }

  async getById(id: string): Promise<Result<Credential>> {
    const row = await credentialsRepo.findById(id);
    if (!row) return err(new Error(`Credential not found: ${id}`));
    const { encryptedValue: _, iv: _iv, tag: _tag, ...credential } = row;
    return ok(credential);
  }

  /** Decrypt and return the raw secret value. Internal use only (agent runtime). */
  async getDecrypted(id: string, workspaceId: string): Promise<Result<string>> {
    const row = await credentialsRepo.findById(id);
    if (!row) return err(new Error(`Credential not found: ${id}`));
    if (row.workspaceId !== workspaceId) return err(new Error('Workspace mismatch'));
    const value = decrypt(row.encryptedValue, row.iv, row.tag, row.workspaceId);
    return ok(value);
  }

  async list(workspaceId: string): Promise<Credential[]> {
    return credentialsRepo.list(workspaceId);
  }

  async update(id: string, input: UpdateCredentialInput): Promise<Result<Credential>> {
    const existing = await credentialsRepo.findById(id);
    if (!existing) return err(new Error(`Credential not found: ${id}`));

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.metadata !== undefined) data.metadata = input.metadata;
    if (input.value !== undefined) {
      const { encrypted, iv, tag } = encrypt(input.value, existing.workspaceId);
      data.encryptedValue = encrypted;
      data.iv = iv;
      data.tag = tag;
    }

    const updated = await credentialsRepo.updateCredential(id, data);
    if (!updated) return err(new Error(`Credential not found: ${id}`));
    return ok(updated);
  }

  async delete(id: string): Promise<boolean> {
    const existing = await credentialsRepo.findById(id);
    const deleted = await credentialsRepo.remove(id);
    if (deleted && existing) {
      eventBus.publish(Topics.CREDENTIAL_DELETED, {
        credentialId: id,
        workspaceId: existing.workspaceId,
      }).catch((err: unknown) => logger.error({ err, credentialId: id }, 'Failed to publish CREDENTIAL_DELETED event'));
    }
    return deleted;
  }

  async getByProvider(
    workspaceId: string,
    provider: import('./credentials.types').CredentialProvider,
  ): Promise<{ value: string; metadata: Record<string, unknown> } | null> {
    const row = await credentialsRepo.findByProvider(workspaceId, provider);
    if (!row) return null;
    const value = decrypt(row.encryptedValue, row.iv, row.tag, row.workspaceId);
    return { value, metadata: row.metadata };
  }
}

export const credentialsService = new CredentialsService();
