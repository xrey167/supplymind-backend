import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';

// ── Mock heavy infra before any service import ────────────────────────────────

const mockTransaction = mock(async (cb: (tx: any) => Promise<any>) => {
  const tx = {
    insert: mock(() => ({
      values: mock((vals: any) => ({
        returning: mock(() =>
          Promise.resolve([{
            id: vals?.id ?? 'ws-123',
            name: vals?.name ?? 'Test Workspace',
            slug: vals?.slug ?? 'test-workspace',
            createdBy: vals?.createdBy ?? 'user-1',
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
            deletedAt: null,
          }]),
        ),
      })),
    })),
  };
  return cb(tx);
});

function makeDbMock() {
  return {
    transaction: mockTransaction,
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([]) }),
        innerJoin: () => ({ where: () => Promise.resolve([]) }),
      }),
    }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]) }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
}

mock.module('../../../infra/db/client', () => ({ db: makeDbMock() }));

mock.module('../../../infra/db/schema', () => ({
  workspaces: {},
  workspaceMembers: {},
}));

mock.module('../../../events/bus', () => ({
  eventBus: { publish: mock(() => Promise.resolve()), subscribe: mock(() => 'sub-mock'), unsubscribe: mock(() => {}) },
}));


// ── Import modules under test after mocks are set up ─────────────────────────
import { workspacesRepo } from '../workspaces.repo';
import { workspacesService } from '../workspaces.service';
import { eventBus } from '../../../events/bus';
import { NotFoundError, ValidationError } from '../../../core/errors';

// Helper to build a fake workspace
function fakeWorkspace(overrides: Record<string, any> = {}) {
  return {
    id: 'ws-123',
    name: 'Test Workspace',
    slug: 'test-workspace',
    createdBy: 'user-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null as Date | null,
    ...overrides,
  };
}

describe('WorkspacesService', () => {
  beforeEach(() => {
    mockTransaction.mockClear();
    (eventBus.publish as ReturnType<typeof mock>).mockClear();
  });

  // ── create ───────────────────────────────────────────────────────────────
  describe('create', () => {
    it('generates slug from name and calls db.transaction', async () => {
      spyOn(workspacesRepo, 'slugExists').mockResolvedValue(false);
      mockTransaction.mockImplementationOnce(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          insert: mock(() => ({
            values: mock(() => ({
              returning: mock(() =>
                Promise.resolve([{
                  id: 'ws-123', name: 'My Workspace', slug: 'my-workspace',
                  createdBy: 'user-1', createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
                }]),
              ),
            })),
          })),
        };
        return cb(tx);
      });

      const result = await workspacesService.create({ name: 'My Workspace', userId: 'user-1' });

      expect(result.slug).toBe('my-workspace');
      expect(result.name).toBe('My Workspace');
      expect(result.createdBy).toBe('user-1');
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    it('publishes WORKSPACE_CREATED event after creation', async () => {
      spyOn(workspacesRepo, 'slugExists').mockResolvedValue(false);
      mockTransaction.mockImplementationOnce(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          insert: mock(() => ({
            values: mock(() => ({
              returning: mock(() =>
                Promise.resolve([{
                  id: 'ws-999', name: 'Acme', slug: 'acme',
                  createdBy: 'user-2', createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
                }]),
              ),
            })),
          })),
        };
        return cb(tx);
      });

      await workspacesService.create({ name: 'Acme', userId: 'user-2' });

      expect(eventBus.publish).toHaveBeenCalledWith('workspace.created', expect.objectContaining({
        workspaceId: 'ws-999',
        createdBy: 'user-2',
      }));
    });

    it('appends random suffix when slug already exists on first attempt', async () => {
      // Create a fresh spy — clear any previous calls from prior tests
      const slugExistsSpy = spyOn(workspacesRepo, 'slugExists')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      slugExistsSpy.mockClear();

      mockTransaction.mockImplementationOnce(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          insert: mock(() => ({
            values: mock(() => ({
              returning: mock(() =>
                Promise.resolve([{
                  id: 'ws-111', name: 'Acme', slug: 'acme-xxxx',
                  createdBy: 'user-1', createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
                }]),
              ),
            })),
          })),
        };
        return cb(tx);
      });

      const result = await workspacesService.create({ name: 'Acme', userId: 'user-1' });
      expect(slugExistsSpy).toHaveBeenCalledTimes(2);
      expect(result).toBeDefined();
    });

    it('throws ValidationError when all 3 slug attempts are taken', async () => {
      spyOn(workspacesRepo, 'slugExists').mockResolvedValue(true);

      await expect(workspacesService.create({ name: 'Taken', userId: 'user-1' }))
        .rejects.toBeInstanceOf(ValidationError);
    });
  });

  // ── getById ──────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('returns workspace when found', async () => {
      spyOn(workspacesRepo, 'findById').mockResolvedValue(fakeWorkspace());

      const result = await workspacesService.getById('ws-123');
      expect(result.id).toBe('ws-123');
    });

    it('throws NotFoundError when not found', async () => {
      spyOn(workspacesRepo, 'findById').mockResolvedValue(null);

      await expect(workspacesService.getById('missing')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ── update ───────────────────────────────────────────────────────────────
  describe('update', () => {
    it('updates workspace and publishes WORKSPACE_UPDATED event', async () => {
      spyOn(workspacesRepo, 'findBySlug').mockResolvedValue(null);
      spyOn(workspacesRepo, 'update').mockResolvedValue(fakeWorkspace({ name: 'Updated Name' }));

      const result = await workspacesService.update('ws-123', { name: 'Updated Name' });

      expect(result.name).toBe('Updated Name');
      expect(eventBus.publish).toHaveBeenCalledWith('workspace.updated', expect.objectContaining({
        workspaceId: 'ws-123',
      }));
    });

    it('throws ValidationError when slug is already taken by another workspace', async () => {
      spyOn(workspacesRepo, 'findBySlug').mockResolvedValue(fakeWorkspace({ id: 'ws-OTHER', slug: 'taken-slug' }));

      await expect(workspacesService.update('ws-123', { slug: 'taken-slug' }))
        .rejects.toBeInstanceOf(ValidationError);
    });

    it('allows updating slug to the same workspace own slug', async () => {
      spyOn(workspacesRepo, 'findBySlug').mockResolvedValue(fakeWorkspace({ id: 'ws-123', slug: 'my-slug' }));
      spyOn(workspacesRepo, 'update').mockResolvedValue(fakeWorkspace({ slug: 'my-slug' }));

      const result = await workspacesService.update('ws-123', { slug: 'my-slug' });
      expect(result.slug).toBe('my-slug');
    });

    it('throws NotFoundError when workspace not found during update', async () => {
      spyOn(workspacesRepo, 'findBySlug').mockResolvedValue(null);
      spyOn(workspacesRepo, 'update').mockResolvedValue(null);

      await expect(workspacesService.update('ws-missing', { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ── delete ───────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('soft-deletes workspace and publishes WORKSPACE_DELETING event', async () => {
      spyOn(workspacesRepo, 'findById').mockResolvedValue(fakeWorkspace());
      spyOn(workspacesRepo, 'softDelete').mockResolvedValue(undefined);

      await workspacesService.delete('ws-123', 'user-1');

      expect(workspacesRepo.softDelete).toHaveBeenCalledWith('ws-123');
      expect(eventBus.publish).toHaveBeenCalledWith('workspace.deleting', expect.objectContaining({
        workspaceId: 'ws-123',
        deletedBy: 'user-1',
      }));
    });

    it('throws NotFoundError when workspace does not exist', async () => {
      spyOn(workspacesRepo, 'findById').mockResolvedValue(null);

      await expect(workspacesService.delete('missing', 'user-1')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ── slug generation (tested via create) ──────────────────────────────────
  describe('slug generation', () => {
    async function slugFrom(name: string): Promise<string> {
      spyOn(workspacesRepo, 'slugExists').mockResolvedValue(false);
      let capturedSlug = '';
      let insertCallNum = 0;
      mockTransaction.mockImplementationOnce(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          insert: mock(() => {
            insertCallNum++;
            const isWorkspace = insertCallNum === 1;
            return {
              values: mock((v: any) => {
                if (isWorkspace) capturedSlug = v.slug ?? '';
                return {
                  returning: mock(() =>
                    Promise.resolve(isWorkspace ? [{
                      id: 'ws-x', name, slug: capturedSlug,
                      createdBy: 'user-1', createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
                    }] : []),
                  ),
                };
              }),
            };
          }),
        };
        return cb(tx);
      });
      await workspacesService.create({ name, userId: 'user-1' });
      return capturedSlug;
    }

    it('lowercases and replaces spaces with hyphens', async () => {
      const slug = await slugFrom('My Cool Workspace');
      expect(slug).toBe('my-cool-workspace');
    });

    it('strips special characters', async () => {
      const slug = await slugFrom('Hello! World@2026');
      expect(slug).toBe('hello-world-2026');
    });

    it('removes leading and trailing hyphens', async () => {
      const slug = await slugFrom('  --trimmed--  ');
      expect(slug).toBe('trimmed');
    });

    it('collapses multiple consecutive separators into one hyphen', async () => {
      const slug = await slugFrom('a  b   c');
      expect(slug).toBe('a-b-c');
    });
  });
});
