export interface CredentialCreatedEvent {
  credentialId: string;
  workspaceId: string;
  name: string;
  provider: string;
}

export interface CredentialDeletedEvent {
  credentialId: string;
  workspaceId: string;
}
