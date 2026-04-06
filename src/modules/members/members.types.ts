export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  invitedBy: string | null;
  joinedAt: Date;
}

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string | null;
  tokenHash: string;
  type: 'email' | 'link';
  role: string;
  invitedBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

export interface InviteInput {
  email?: string;
  role?: string;
  invitedBy: string;
}

export interface MemberWithUser extends WorkspaceMember {
  userName: string | null;
  userEmail: string | null;
  userAvatarUrl: string | null;
}
