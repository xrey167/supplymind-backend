import { join, dirname } from 'node:path';
import { mkdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';

export interface StorageProvider {
  put(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
}

export class LocalStorage implements StorageProvider {
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath ?? Bun.env.STORAGE_PATH ?? './data/storage';
  }

  private filePath(key: string): string {
    return join(this.basePath, key);
  }

  private async ensureDir(filePath: string): Promise<void> {
    const dir = dirname(filePath);
    if (dir) {
      await mkdir(dir, { recursive: true });
    }
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
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      await unlink(this.filePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.filePath(key));
      return true;
    } catch {
      return false;
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
