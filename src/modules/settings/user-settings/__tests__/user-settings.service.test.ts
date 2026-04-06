import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockGet = mock(async () => null as unknown);
const mockGetAll = mock(async () => ({} as Record<string, unknown>));
const mockSet = mock(async () => {});
const mockDelete = mock(async () => true);

mock.module('../user-settings.repo', () => ({
  userSettingsRepo: {
    get: mockGet,
    getAll: mockGetAll,
    set: mockSet,
    delete: mockDelete,
  },
}));

mock.module('../../../../config/logger', () => ({
  logger: {
    warn: mock(() => {}),
    info: mock(() => {}),
    error: mock(() => {}),
  },
}));

import { UserSettingsService } from '../user-settings.service';
import { USER_SETTING_DEFAULTS } from '../user-settings.schemas';

describe('UserSettingsService', () => {
  let service: UserSettingsService;

  beforeEach(() => {
    service = new UserSettingsService();
    mockGet.mockClear();
    mockGetAll.mockClear();
    mockSet.mockClear();
    mockDelete.mockClear();
  });

  describe('get', () => {
    test('should return value when setting exists', async () => {
      mockGet.mockResolvedValueOnce('dark');

      const result = await service.get('u1', 'theme');

      expect(result).toBe('dark');
      expect(mockGet).toHaveBeenCalledWith('u1', 'theme');
    });

    test('should return null when setting does not exist', async () => {
      mockGet.mockResolvedValueOnce(null);

      const result = await service.get('u1', 'theme');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    test('should validate and set a known key', async () => {
      await service.set('u1', 'theme', 'dark');

      expect(mockSet).toHaveBeenCalledWith('u1', 'theme', 'dark');
    });

    test('should throw for invalid value on known key', async () => {
      await expect(service.set('u1', 'theme', 'invalid-theme')).rejects.toThrow(
        /Invalid value for setting "theme"/,
      );
      expect(mockSet).not.toHaveBeenCalled();
    });

    test('should accept unknown keys without validation', async () => {
      await service.set('u1', 'custom_key', { foo: 'bar' });

      expect(mockSet).toHaveBeenCalledWith('u1', 'custom_key', { foo: 'bar' });
    });

    test('should validate boolean settings', async () => {
      await service.set('u1', 'notifications_email', true);
      expect(mockSet).toHaveBeenCalledWith('u1', 'notifications_email', true);
    });

    test('should reject invalid boolean settings', async () => {
      await expect(service.set('u1', 'notifications_email', 'yes')).rejects.toThrow(
        /Invalid value for setting "notifications_email"/,
      );
    });
  });

  describe('getAll', () => {
    test('should merge stored settings with defaults', async () => {
      mockGetAll.mockResolvedValueOnce({ theme: 'dark', locale: 'fr' });

      const result = await service.getAll('u1');

      expect(result.theme).toBe('dark');
      expect(result.locale).toBe('fr');
      expect(result.timezone).toBe(USER_SETTING_DEFAULTS.timezone);
      expect(result.notifications_email).toBe(USER_SETTING_DEFAULTS.notifications_email);
    });

    test('should return all defaults when no settings stored', async () => {
      mockGetAll.mockResolvedValueOnce({});

      const result = await service.getAll('u1');

      expect(result).toEqual(USER_SETTING_DEFAULTS);
    });
  });

  describe('delete', () => {
    test('should return true when deleted', async () => {
      mockDelete.mockResolvedValueOnce(true);

      const result = await service.delete('u1', 'theme');

      expect(result).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith('u1', 'theme');
    });

    test('should return false when not found', async () => {
      mockDelete.mockResolvedValueOnce(false);

      const result = await service.delete('u1', 'nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('typed getters', () => {
    test('getTheme returns stored value', async () => {
      mockGet.mockResolvedValueOnce('dark');

      const result = await service.getTheme('u1');

      expect(result).toBe('dark');
    });

    test('getTheme returns default when null', async () => {
      mockGet.mockResolvedValueOnce(null);

      const result = await service.getTheme('u1');

      expect(result).toBe('system');
    });

    test('getLocale returns stored value', async () => {
      mockGet.mockResolvedValueOnce('fr');

      const result = await service.getLocale('u1');

      expect(result).toBe('fr');
    });

    test('getLocale returns default when null', async () => {
      mockGet.mockResolvedValueOnce(null);

      const result = await service.getLocale('u1');

      expect(result).toBe('en');
    });

    test('getTimezone returns stored value', async () => {
      mockGet.mockResolvedValueOnce('America/New_York');

      const result = await service.getTimezone('u1');

      expect(result).toBe('America/New_York');
    });

    test('getTimezone returns default when null', async () => {
      mockGet.mockResolvedValueOnce(null);

      const result = await service.getTimezone('u1');

      expect(result).toBe('UTC');
    });
  });
});
