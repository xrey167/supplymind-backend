import { db } from '../../infra/db/client';
import { workspaces as workspacesTable, workspaceMembers } from '../../infra/db/schema';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { NotFoundError, ValidationError } from '../../core/errors';
import { workspacesRepo } from './workspaces.repo';
import type { Workspace, CreateWorkspaceInput, UpdateWorkspaceInput } from './workspaces.types';

function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

class WorkspacesService {
  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    let slug = generateSlug(input.name);

    for (let attempt = 0; attempt < 3; attempt++) {
      const candidateSlug = attempt === 0 ? slug : `${slug}-${randomSuffix()}`;
      const exists = await workspacesRepo.slugExists(candidateSlug);
      if (!exists) {
        slug = candidateSlug;
        break;
      }
      if (attempt === 2) {
        throw new ValidationError(`Could not generate unique slug for "${input.name}"`);
      }
    }

    // Transaction: create workspace + add creator as owner
    const workspace = await db.transaction(async (tx) => {
      const [wsRow] = await tx.insert(workspacesTable).values({
        name: input.name,
        slug,
        createdBy: input.userId,
      }).returning();

      await tx.insert(workspaceMembers).values({
        workspaceId: wsRow.id,
        userId: input.userId,
        role: 'owner',
      });

      return {
        id: wsRow.id,
        name: wsRow.name,
        slug: wsRow.slug,
        createdBy: wsRow.createdBy,
        createdAt: wsRow.createdAt!,
        updatedAt: wsRow.updatedAt!,
        deletedAt: wsRow.deletedAt,
      } as Workspace;
    });

    eventBus.publish(Topics.WORKSPACE_CREATED, {
      workspaceId: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      createdBy: input.userId,
    });

    return workspace;
  }

  async getById(id: string): Promise<Workspace> {
    const ws = await workspacesRepo.findById(id);
    if (!ws) throw new NotFoundError(`Workspace not found: ${id}`);
    return ws;
  }

  async getBySlug(slug: string): Promise<Workspace> {
    const ws = await workspacesRepo.findBySlug(slug);
    if (!ws) throw new NotFoundError(`Workspace not found: ${slug}`);
    return ws;
  }

  async listForUser(userId: string): Promise<Workspace[]> {
    return workspacesRepo.findByUserId(userId);
  }

  async update(id: string, input: UpdateWorkspaceInput): Promise<Workspace> {
    if (input.slug) {
      const existing = await workspacesRepo.findBySlug(input.slug);
      if (existing && existing.id !== id) {
        throw new ValidationError(`Slug "${input.slug}" is already taken`);
      }
    }
    const ws = await workspacesRepo.update(id, input);
    if (!ws) throw new NotFoundError(`Workspace not found: ${id}`);
    eventBus.publish(Topics.WORKSPACE_UPDATED, { workspaceId: id, changes: Object.keys(input) });
    return ws;
  }

  async delete(id: string, deletedBy: string): Promise<void> {
    const ws = await workspacesRepo.findById(id);
    if (!ws) throw new NotFoundError(`Workspace not found: ${id}`);
    await workspacesRepo.softDelete(id);
    eventBus.publish(Topics.WORKSPACE_DELETING, { workspaceId: id, deletedBy });
  }
}

export const workspacesService = new WorkspacesService();
