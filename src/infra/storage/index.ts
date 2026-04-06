import { join, resolve } from 'node:path';
import { mkdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { logger } from '../../config/logger';

export interface StorageProvider {
  put(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
}

export class LocalStorage implements StorageProvider {
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = resolve(basePath ?? Bun.env.STORAGE_PATH ?? './data/storage');
  }

  private filePath(key: string): string {
    const resolved = resolve(join(this.basePath, key));
    if (!resolved.startsWith(this.basePath)) {
      throw new Error('Invalid storage key: path traversal detected');
    }
    return resolved;
  }

  private async ensureDir(filePath: string): Promise<void> {
    const dir = resolve(filePath, '..');
    await mkdir(dir, { recursive: true });
  }

  async put(key: string, data: Buffer | Uint8Array, _contentType?: string): Promise<string> {
    const path = this.filePath(key);
    await this.ensureDir(path);
    await writeFile(path, data);
    return path;
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.filePath(key));
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null;
      logger.error({ key, err }, 'Storage read failed');
      throw err;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      await unlink(this.filePath(key));
      return true;
    } catch (err: any) {
      if (err?.code === 'ENOENT') return false;
      logger.error({ key, err }, 'Storage delete failed');
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.filePath(key));
      return true;
    } catch (err: any) {
      if (err?.code === 'ENOENT') return false;
      logger.error({ key, err }, 'Storage stat failed');
      throw err;
    }
  }
}

let instance: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!instance) {
    instance = new LocalStorage();
  }
  return instance;
}
