/**
 * Plugin Prompt Seeder
 *
 * Seeds prompt templates from a plugin's contribution into a workspace's
 * prompts table when the plugin is installed, and removes them on uninstall.
 *
 * Uses `onConflictDoNothing` so seeding is idempotent — safe to run multiple
 * times without creating duplicate prompts.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { prompts } from '../../infra/db/schema';
import type { PromptTemplateContribution } from './plugin-contribution-registry';

/**
 * Seed prompt templates from a plugin's contribution into a workspace.
 * Names are stored as `{pluginId}/{name}` to avoid collisions with user prompts.
 * Variable placeholders (`{{var}}`) are auto-extracted from content.
 */
export async function seedPluginPrompts(
  workspaceId: string,
  pluginId: string,
  templates: PromptTemplateContribution[],
): Promise<void> {
  if (!templates.length) return;
  const rows = templates.map((t) => ({
    id: crypto.randomUUID(),
    workspaceId,
    name: `${pluginId}/${t.name}`,
    description: t.description ?? null,
    content: t.content,
    variables: extractVariables(t.content),
    tags: t.tags ?? [],
    version: 1,
    isActive: true,
    pluginSource: pluginId,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await db.insert(prompts).values(rows).onConflictDoNothing();
}

/**
 * Remove all prompts seeded by a specific plugin for a workspace.
 * Called during plugin uninstall to clean up plugin-owned prompts.
 */
export async function removePluginPrompts(
  workspaceId: string,
  pluginId: string,
): Promise<void> {
  await db.delete(prompts).where(
    and(eq(prompts.workspaceId, workspaceId), eq(prompts.pluginSource, pluginId)),
  );
}

/** Extract `{{variable}}` patterns from template content. */
function extractVariables(content: string): Array<{ name: string }> {
  const matches = content.matchAll(/\{\{(\w+)\}\}/g);
  const seen = new Set<string>();
  const result: Array<{ name: string }> = [];
  for (const match of matches) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      result.push({ name: match[1] });
    }
  }
  return result;
}
