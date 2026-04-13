/**
 * Skill Generator — Phase 3
 *
 * Detects skill gaps from learning observations and generates new skill stubs
 * via LLM. Generated skills are tested in the existing sandbox before
 * registration. Gate: learning.generativeExtension feature flag + AUTONOMOUS+ tier.
 *
 * Safety: generated handler code runs via src/core/security/sandbox.ts —
 * same isolated subprocess mechanism used for admin-defined inline tools.
 * Import whitelist enforced at parse time: only core result/types utilities allowed.
 */

import { db } from '../../../infra/db/client';
import { learningObservations } from '../../../infra/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { AnthropicRawRuntime } from '../../../infra/ai/anthropic';
import { runInSandbox } from '../../../core/security/sandbox';
import { skillRegistry } from '../../skills/skills.registry';
import { ok } from '../../../core/result';
import { logger } from '../../../config/logger';
import type { ImprovementProposal } from '../analyzers/skill-weight-analyzer';
import type { SandboxPolicy } from '../../settings/workspace-settings/workspace-settings.schemas';

const MIN_GAP_OCCURRENCES = 3; // signal must appear at least 3 times
const GENERATION_MODEL = 'claude-sonnet-4-6';

// Allowed imports in generated skill handlers (checked via string scan)
const ALLOWED_IMPORT_PREFIXES = [
  '../skills/skills.types',
  '../../core/result',
  '../../../core/result',
];

const SANDBOX_POLICY: SandboxPolicy = {
  maxTimeoutMs: 5_000,
  allowNetwork: false,
  allowedPaths: [],
  deniedPaths: [],
  maxMemoryMb: 64,
  lockedByOrg: false,
};

export interface SkillGap {
  skillName: string;
  occurrences: number;
  workspaceId: string;
  context: string;
}

/**
 * Detect skills that were requested but not found in the registry.
 * Reads 'skill_not_found' observations from the last 7 days.
 */
export async function detectSkillGaps(workspaceId: string, dbClient = db): Promise<SkillGap[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rows = await dbClient
    .select({
      skillName: sql<string>`payload->>'skillName'`,
      context: sql<string>`payload->>'context'`,
      count: sql<number>`count(*)::int`,
    })
    .from(learningObservations)
    .where(and(
      eq(learningObservations.workspaceId, workspaceId),
      eq(learningObservations.observationType, 'skill_not_found'),
      gte(learningObservations.createdAt, since),
    ))
    .groupBy(sql`payload->>'skillName'`, sql`payload->>'context'`);

  return rows
    .filter((r) => r.count >= MIN_GAP_OCCURRENCES && r.skillName)
    .map((r) => ({
      skillName: r.skillName,
      occurrences: r.count,
      workspaceId,
      context: r.context ?? '',
    }));
}

/**
 * Generate a skill proposal via LLM for a detected gap.
 * Returns an ImprovementProposal of type 'new_skill' if generation succeeds.
 */
export async function generateSkillForGap(
  gap: SkillGap,
  domainContext: string,
): Promise<ImprovementProposal | null> {
  const runtime = new AnthropicRawRuntime();

  const systemPrompt = `You are an expert backend developer generating TypeScript skill handlers for an AI platform.
A skill is a function that takes typed arguments and returns a result.

${domainContext ? `Domain context:\n${domainContext}\n` : ''}

Generate a skill handler following this exact structure:
\`\`\`typescript
// name: <snake_case_skill_name>
// description: <one sentence description>
// inputSchema: <JSON Schema object for the args>
async function handler(args: Record<string, unknown>): Promise<unknown> {
  // implementation
  return { result: '...' };
}
\`\`\`

Rules:
- Do NOT import anything. The handler must be self-contained.
- Return a plain JSON-serialisable object.
- Keep the handler under 30 lines.
- Validate required args at the top with: if (!args.X) throw new Error('Missing X');`;

  const result = await runtime.run({
    model: GENERATION_MODEL,
    messages: [{
      role: 'user',
      content: `Generate a skill for: "${gap.skillName}"\nContext: ${gap.context}\nOccurrences: ${gap.occurrences}`,
    }],
    systemPrompt,
    maxTokens: 800,
    temperature: 0.3,
  });

  if (!result.ok) {
    logger.warn({ gap: gap.skillName, error: result.error.message }, 'Skill generation LLM call failed');
    return null;
  }

  const generated = parseGeneratedSkill(result.value.content);
  if (!generated) {
    logger.warn({ gap: gap.skillName }, 'Could not parse generated skill from LLM output');
    return null;
  }

  return {
    workspaceId: gap.workspaceId,
    proposalType: 'new_skill',
    changeType: 'structural',
    description: `Auto-generated skill "${generated.name}" to fill gap detected ${gap.occurrences} times: ${generated.description}`,
    evidence: [
      `gap_occurrences=${gap.occurrences}`,
      `gap_name=${gap.skillName}`,
      `context=${gap.context.slice(0, 100)}`,
    ],
    beforeValue: null,
    afterValue: {
      skillName: generated.name,
      description: generated.description,
      inputSchema: generated.inputSchema,
      handlerCode: generated.handlerCode,
    },
    confidence: Math.min(0.8, 0.5 + gap.occurrences * 0.05),
  };
}

/**
 * Test the generated handler code in sandbox and register if it passes.
 * Called when a new_skill proposal is approved (or auto-applied at TRUSTED tier).
 */
export async function testAndRegisterGeneratedSkill(
  workspaceId: string,
  skillData: {
    skillName: string;
    description: string;
    inputSchema: Record<string, unknown>;
    handlerCode: string;
  },
): Promise<boolean> {
  // Safety: scan for disallowed imports
  if (containsDisallowedImports(skillData.handlerCode)) {
    logger.warn({ skillName: skillData.skillName }, 'Generated skill rejected: contains disallowed imports');
    return false;
  }

  // Test in sandbox with empty args
  const sandboxResult = await runInSandbox({
    code: skillData.handlerCode,
    args: {},
    policy: SANDBOX_POLICY,
    toolId: `generated:${skillData.skillName}`,
    toolName: skillData.skillName,
  });

  if (!sandboxResult.ok) {
    logger.warn({ skillName: skillData.skillName, error: sandboxResult.error.message }, 'Generated skill sandbox test failed');
    return false;
  }

  // Register with low priority (2) — below plugins (3), above system defaults
  const skillId = `generated:${workspaceId}:${skillData.skillName}`;
  skillRegistry.register({
    id: skillId,
    name: skillData.skillName,
    description: skillData.description,
    inputSchema: skillData.inputSchema,
    providerType: 'inline', // closest existing type for generated skills
    priority: 2,
    handler: async (args) => {
      const result = await runInSandbox({
        code: skillData.handlerCode,
        args,
        policy: SANDBOX_POLICY,
        toolId: skillId,
        toolName: skillData.skillName,
      });
      if (!result.ok) throw result.error;
      return ok(result.value.value);
    },
  });

  logger.info({ skillId, skillName: skillData.skillName, workspaceId }, 'Generated skill registered');
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParsedSkill {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handlerCode: string;
}

function parseGeneratedSkill(content: string): ParsedSkill | null {
  try {
    const nameMatch = content.match(/\/\/\s*name:\s*([^\n]+)/);
    const descMatch = content.match(/\/\/\s*description:\s*([^\n]+)/);
    const schemaMatch = content.match(/\/\/\s*inputSchema:\s*(\{[^}]+\})/s);
    const codeMatch = content.match(/```(?:typescript|ts)?\n([\s\S]+?)```/);

    if (!nameMatch || !descMatch || !codeMatch) return null;

    const name = nameMatch[1]!.trim().replace(/\s+/g, '_').toLowerCase();
    const description = descMatch[1]!.trim();
    const handlerCode = codeMatch[1]!.trim();

    let inputSchema: Record<string, unknown> = { type: 'object', properties: {} };
    if (schemaMatch?.[1]) {
      try { inputSchema = JSON.parse(schemaMatch[1]); } catch { /* use default */ }
    }

    return { name, description, inputSchema, handlerCode };
  } catch {
    return null;
  }
}

/**
 * Advisory pre-registration scan for obvious disallowed imports.
 * This is a best-effort check only — it can be bypassed by obfuscation
 * (template literals, dynamic eval, globalThis['require'], etc.).
 * The real enforcement boundary is `runInSandbox` in src/core/security/sandbox.ts,
 * which provides process-level isolation for generated handler code.
 */
function containsDisallowedImports(code: string): boolean {
  const importMatches = code.match(/import\s+.+\s+from\s+['"]([^'"]+)['"]/g) ?? [];
  for (const importLine of importMatches) {
    const moduleMatch = importLine.match(/from\s+['"]([^'"]+)['"]/);
    if (!moduleMatch) continue;
    const modulePath = moduleMatch[1]!;
    const isAllowed = ALLOWED_IMPORT_PREFIXES.some((prefix) => modulePath.startsWith(prefix));
    if (!isAllowed) return true;
  }
  // Also block require() calls
  if (/require\s*\(/.test(code)) return true;
  return false;
}
