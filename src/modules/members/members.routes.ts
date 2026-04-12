import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../../core/types';
import { z } from 'zod';
import { membersService } from './members.service';
import { hasPermission } from '../../core/security/rbac';
import { ForbiddenError } from '../../core/errors';
import {
  createInvitationSchema,
  updateRoleSchema,
  memberUserIdParamSchema,
  invitationIdParamSchema,
} from './members.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };
const errRes = (desc: string) => ({ description: desc, ...jsonRes });

function requireAdmin(c: any): void {
  const callerRole = c.get('callerRole') as string;
  if (!hasPermission(callerRole, 'admin')) throw new ForbiddenError('Insufficient permissions');
}

function requireOwner(c: any): void {
  const workspaceRole = c.get('workspaceRole') as string;
  if (workspaceRole !== 'owner') throw new ForbiddenError('Only owners can perform this action');
}

const listMembersRoute = createRoute({
  method: 'get', path: '/',
  responses: { 200: { description: 'List members', ...jsonRes } },
});

const createInvitationRoute = createRoute({
  method: 'post', path: '/invitations',
  request: { body: { content: { 'application/json': { schema: createInvitationSchema } } } },
  responses: { 201: { description: 'Invitation created', ...jsonRes } },
});

const listInvitationsRoute = createRoute({
  method: 'get', path: '/invitations',
  responses: { 200: { description: 'List pending invitations', ...jsonRes } },
});

const revokeInvitationRoute = createRoute({
  method: 'delete', path: '/invitations/{id}',
  request: { params: invitationIdParamSchema },
  responses: { 204: { description: 'Invitation revoked' } },
});

const updateRoleRoute = createRoute({
  method: 'patch', path: '/{userId}/role',
  request: {
    params: memberUserIdParamSchema,
    body: { content: { 'application/json': { schema: updateRoleSchema } } },
  },
  responses: { 200: { description: 'Role updated', ...jsonRes } },
});

const removeMemberRoute = createRoute({
  method: 'delete', path: '/{userId}',
  request: { params: memberUserIdParamSchema },
  responses: { 204: { description: 'Member removed' } },
});

export const MembersRoutes = new OpenAPIHono<AppEnv>();

MembersRoutes.openapi(listMembersRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const members = await membersService.listMembers(workspaceId);
  return c.json({ data: members });
});

MembersRoutes.openapi(createInvitationRoute, async (c) => {
  requireAdmin(c);
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('callerId') as string;
  const body = c.req.valid('json');
  const result = await membersService.invite(workspaceId, { email: body.email, role: body.role, invitedBy: callerId });
  return c.json({ data: { token: result.token, invitation: result.invitation } }, 201);
});

MembersRoutes.openapi(listInvitationsRoute, async (c) => {
  requireAdmin(c);
  const workspaceId = c.get('workspaceId') as string;
  const invitations = await membersService.listPendingInvitations(workspaceId);
  return c.json({ data: invitations });
});

MembersRoutes.openapi(revokeInvitationRoute, async (c) => {
  requireAdmin(c);
  const workspaceId = c.get('workspaceId') as string;
  const { id } = c.req.valid('param');
  await membersService.revokeInvitation(workspaceId, id);
  return c.body(null, 204);
});

MembersRoutes.openapi(updateRoleRoute, async (c) => {
  requireOwner(c);
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('callerId') as string;
  const { userId } = c.req.valid('param');
  const { role } = c.req.valid('json');
  const member = await membersService.updateRole(workspaceId, userId, role, callerId);
  return c.json({ data: member });
});

MembersRoutes.openapi(removeMemberRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('callerId') as string;
  const { userId } = c.req.valid('param');
  if (userId !== callerId) requireAdmin(c);
  await membersService.removeMember(workspaceId, userId, callerId);
  return c.body(null, 204);
});
