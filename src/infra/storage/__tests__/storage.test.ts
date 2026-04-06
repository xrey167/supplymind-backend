import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStorage } from '../index';

describe('LocalStorage', () => {
  let storage: LocalStorage;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'storage-test-'));
    storage = new LocalStorage(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('put stores data and returns path', async () => {
    const data = Buffer.from('hello world');
    const path = await storage.put('test.txt', data);
    expect(path).toContain('test.txt');
  });

  test('get retrieves stored data', async () => {
    const data = Buffer.from('hello world');
    await storage.put('test.txt', data);
    const result = await storage.get('test.txt');
    expect(result).not.toBeNull();
    expect(result!.toString()).toBe('hello world');
  });

  test('get returns null for missing key', async () => {
    const result = await storage.get('nonexistent.txt');
    expect(result).toBeNull();
  });

  test('exists returns true for stored key', async () => {
    await storage.put('test.txt', Buffer.from('data'));
    expect(await storage.exists('test.txt')).toBe(true);
  });

  test('exists returns false for missing key', async () => {
    expect(await storage.exists('nope.txt')).toBe(false);
  });

  test('delete removes stored file', async () => {
    await storage.put('test.txt', Buffer.from('data'));
    const deleted = await storage.delete('test.txt');
    expect(deleted).toBe(true);
    expect(await storage.exists('test.txt')).toBe(false);
  });

  test('delete returns false for missing key', async () => {
    const deleted = await storage.delete('nope.txt');
    expect(deleted).toBe(false);
  });

  test('put handles nested keys', async () => {
    const data = Buffer.from('nested');
    await storage.put('a/b/c.txt', data);
    const result = await storage.get('a/b/c.txt');
    expect(result!.toString()).toBe('nested');
  });
});
