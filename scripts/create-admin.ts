/**
 * Creates an admin workspace + user membership + API key for local development.
 *
 * Usage:
 *   bun scripts/create-admin.ts
 *   bun scripts/create-admin.ts --workspace-name "My Workspace" --user-id "user_abc123"
 *
 * Outputs the workspace ID and API key to stdout. Safe to run multiple times
 * (uses upsert / idempotent inserts where possible).
 */
import { workspacesRepo } from '../src/modules/workspaces/workspaces.repo';
import { membersRepo } from '../src/modules/members/members.repo';
import { db } from '../src/infra/db/client';
import { apiKeys } from '../src/infra/db/schema';
import { randomBytes, createHash } from 'crypto';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
    .map(([k, v]) => [k, v ?? 'true']),
);

const workspaceName = args['workspace-name'] ?? 'Admin Workspace';
const workspaceSlug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const userId = args['user-id'] ?? 'dev-admin';

console.log(`\nCreating admin workspace "${workspaceName}" for user "${userId}"...\n`);

// 1. Upsert workspace
let workspace = await workspacesRepo.findBySlug(workspaceSlug);

if (!workspace) {
  workspace = await workspacesRepo.create({ name: workspaceName, slug: workspaceSlug, createdBy: userId });
  console.log(`  ✓ Workspace created: ${workspace.id}`);
} else {
  console.log(`  ✓ Workspace exists:  ${workspace.id}`);
}

const workspaceId = workspace.id;

// 2. Upsert membership (owner role)
const existing = await membersRepo.findMember(workspaceId, userId);

if (!existing) {
  await membersRepo.addMember(workspaceId, userId, 'owner', userId);
  console.log(`  ✓ Membership created: ${userId} → owner`);
} else {
  console.log(`  ✓ Membership exists:  ${userId} → ${existing.role}`);
}

// 3. Generate API key
const rawKey = `a2a_k_${randomBytes(32).toString('hex')}`;
const keyHash = createHash('sha256').update(rawKey).digest('hex');
const keyPrefix = rawKey.slice(0, 12);

await db.insert(apiKeys).values({
  workspaceId,
  name: 'Admin Dev Key',
  keyHash,
  keyPrefix,
  role: 'admin',
  enabled: true,
});
console.log(`  ✓ API key created\n`);

console.log('─'.repeat(60));
console.log(`WORKSPACE_ID=${workspaceId}`);
console.log(`API_KEY=${rawKey}`);
console.log('─'.repeat(60));
console.log('\nAdd API_KEY to your requests as: Authorization: Bearer <API_KEY>');
console.log(`Or set ADMIN_WORKSPACE_ID=${workspaceId} in your .env\n`);

process.exit(0);
