import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { membersService } from './members.service';
import {
  createInvitationSchema,
  updateRoleSchema,
  memberUserIdParamSchema,
  invitationIdParamSchema,
} from './members.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

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

export const MembersRoutes = new OpenAPIHono();

MembersRoutes.openapi(listMembersRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const members = await membersService.listMembers(workspaceId);
  return c.json({ data: members });
});

MembersRoutes.openapi(createInvitationRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('callerId') as string;
  const workspaceRole = c.get('workspaceRole') as string;
  if (!['owner', 'admin'].includes(workspaceRole)) return c.json({ error: 'Only admins can create invitations' }, 403);
  const body = c.req.valid('json');
  const result = await membersService.invite(workspaceId, { email: body.email, role: body.role, invitedBy: callerId });
  return c.json({ data: { token: result.token, invitation: result.invitation } }, 201);
});

MembersRoutes.openapi(listInvitationsRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const workspaceRole = c.get('workspaceRole') as string;
  if (!['owner', 'admin'].includes(workspaceRole)) return c.json({ error: 'Only admins can view invitations' }, 403);
  const invitations = await membersService.listPendingInvitations(workspaceId);
  return c.json({ data: invitations });
});

MembersRoutes.openapi(revokeInvitationRoute, async (c) => {
  const workspaceRole = c.get('workspaceRole') as string;
  if (!['owner', 'admin'].includes(workspaceRole)) return c.json({ error: 'Only admins can revoke invitations' }, 403);
  const { id } = c.req.valid('param');
  const { invitationsRepo } = await import('./invitations.repo');
  await invitationsRepo.deleteById(id);
  return c.json({ success: true }, 204);
});

MembersRoutes.openapi(updateRoleRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('callerId') as string;
  const workspaceRole = c.get('workspaceRole') as string;
  if (workspaceRole !== 'owner') return c.json({ error: 'Only owners can change roles' }, 403);
  const { userId } = c.req.valid('param');
  const { role } = c.req.valid('json');
  const member = await membersService.updateRole(workspaceId, userId, role, callerId);
  return c.json({ data: member });
});

MembersRoutes.openapi(removeMemberRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const callerId = c.get('callerId') as string;
  const workspaceRole = c.get('workspaceRole') as string;
  const { userId } = c.req.valid('param');
  if (userId !== callerId && !['owner', 'admin'].includes(workspaceRole)) {
    return c.json({ error: 'Only admins can remove other members' }, 403);
  }
  await membersService.removeMember(workspaceId, userId, callerId);
  return c.json({ success: true }, 204);
});
