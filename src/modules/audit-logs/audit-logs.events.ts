// Audit logs are append-only consumers — they don't emit their own domain events.
// Event subscriptions are handled in src/events/consumers/audit-log.handler.ts.
export {};
