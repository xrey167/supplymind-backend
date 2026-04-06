import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/auth';
import { invitationsRepo } from '../../modules/members/invitations.repo';
import { membersService } from '../../modules/members/members.service';
import { invitationTokenParamSchema } from '../../modules/members/members.schemas';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };

const validateTokenRoute = createRoute({
  method: 'get', path: '/{token}',
  request: { params: invitationTokenParamSchema },
  responses: {
    200: { description: 'Invitation details', ...jsonRes },
    404: { description: 'Not found' },
  },
});

const acceptRoute = createRoute({
  method: 'post', path: '/{token}/accept',
  request: { params: invitationTokenParamSchema },
  responses: {
    200: { description: 'Accepted', ...jsonRes },
    404: { description: 'Not found' },
  },
});

export const invitationRoutes = new OpenAPIHono();

invitationRoutes.openapi(validateTokenRoute, async (c) => {
  const { token } = c.req.valid('param');
  const tokenHash = (() => { const h = new Bun.CryptoHasher('sha256'); h.update(token); return h.digest('hex'); })();
  const invitation = await invitationsRepo.findByTokenHash(tokenHash);
  if (!invitation) return c.json({ error: 'Invitation not found or expired' }, 404);

  const { workspacesRepo } = await import('../../modules/workspaces/workspaces.repo');
  const workspace = await workspacesRepo.findById(invitation.workspaceId);

  return c.json({
    data: {
      workspaceName: workspace?.name ?? 'Unknown',
      role: invitation.role,
      type: invitation.type,
      expiresAt: invitation.expiresAt.toISOString(),
    },
  });
});

invitationRoutes.use('/:token/accept', authMiddleware);

invitationRoutes.openapi(acceptRoute, async (c) => {
  const { token } = c.req.valid('param');
  const callerId = c.get('callerId') as string;

  const { usersRepo } = await import('../../modules/users/users.repo');
  const user = await usersRepo.findById(callerId);
  const userEmail = user?.email ?? '';

  const member = await membersService.acceptInvitation(token, callerId, userEmail);
  return c.json({ data: member });
});
