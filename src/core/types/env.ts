/** Hono context variables set by auth/workspace middleware. */
export type AppEnv = {
  Variables: {
    workspaceId: string;
    callerId: string;
    callerRole: string;
    workspaceRole: string;
    userId: string;
  };
};
