import type { WorkspaceInvitation } from './members.types';
import type { Workspace } from '../workspaces/workspaces.types';

export interface InvitationDeliveryProvider {
  deliver(invitation: WorkspaceInvitation & { token: string }, workspace: Workspace): Promise<void>;
}
