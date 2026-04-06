import { workspaceSettingsRepo } from '../settings/workspace-settings/workspace-settings.repo';
import type { FlagValue } from '../../config/flags';

const FLAG_NAMESPACE = 'feature-flag:';

function isFlagValue(v: unknown): v is FlagValue {
  return typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number';
}

export class FeatureFlagsRepository {
  private dbKey(flag: string): string {
    return `${FLAG_NAMESPACE}${flag}`;
  }

  async get(workspaceId: string, flag: string): Promise<FlagValue | undefined> {
    const row = await workspaceSettingsRepo.get(workspaceId, this.dbKey(flag));
    return isFlagValue(row?.value) ? row.value : undefined;
  }

  async set(workspaceId: string, flag: string, value: FlagValue): Promise<void> {
    await workspaceSettingsRepo.set(workspaceId, this.dbKey(flag), value);
  }

  async getAll(workspaceId: string): Promise<Record<string, FlagValue>> {
    const rows = await workspaceSettingsRepo.getAll(workspaceId);
    return Object.fromEntries(
      rows
        .filter(r => r.key.startsWith(FLAG_NAMESPACE) && isFlagValue(r.value))
        .map(r => [r.key.slice(FLAG_NAMESPACE.length), r.value as FlagValue])
    );
  }
}

export const featureFlagsRepo = new FeatureFlagsRepository();
