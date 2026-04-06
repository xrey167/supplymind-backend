import type { FlagValue } from '../../config/flags';

export interface FlagEntry {
  flag: string;
  value: FlagValue;
  source: 'default' | 'workspace';
}

export type FlagMap = Record<string, FlagValue>;
