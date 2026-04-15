import { eventBus } from '../bus';
import { Topics } from '../topics';
import { taskRepo } from '../../engine/a2a/task-repo';
import { extractFacts, detectConflict } from '../../modules/memory/auto-extract';
import { memoryService } from '../../modules/memory/memory.service';
import { logger } from '../../config/logger';
import type { TranscriptEntry } from '../../modules/sessions/transcript-chain';

const MIN_CONFIDENCE = 0.7;

let registered = false;

/** Reset registration state (for testing only) */
export function _resetMemoryExtractionHandler() {
  registered = false;
}

export function initMemoryExtractionHandler(
  bus = eventBus,
  repo: Pick<typeof taskRepo, 'findRawById'> = taskRepo,
  svc: Pick<typeof memoryService, 'propose' | 'recall'> = memoryService,
) {
  if (registered) return;
  registered = true;

  bus.subscribe(Topics.TASK_COMPLETED, async (event) => {
    const { taskId } = event.data as { taskId: string };

    try {
      // Use findRawById to get workspaceId, agentId, sessionId alongside history
      const row = await repo.findRawById(taskId);
      if (!row) return;

      const history = (row.history as Array<{ role: string; parts: Array<{ kind: string; text?: string }> }>) ?? [];
      if (history.length === 0) return;

      // Convert A2AMessage history to TranscriptEntry format
      const entries: Pick<TranscriptEntry, 'role' | 'content'>[] = history.map((msg) => ({
        role: (msg.role === 'agent' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: msg.parts
          .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text' && !!p.text)
          .map((p) => p.text)
          .join('\n'),
      }));

      const facts = extractFacts(entries);
      const qualifying = facts.filter((f) => f.confidence >= MIN_CONFIDENCE);

      if (qualifying.length === 0) return;

      let proposed = 0;
      for (const fact of qualifying) {
        let evidence = `Auto-extracted (scope: ${fact.scope}) from task ${taskId}`;

        // Check for conflicts with existing memories
        try {
          const existing = await svc.recall({ query: fact.key, workspaceId: row.workspaceId, limit: 3 });
          const conflicting = existing.find(m => m.title === fact.key && detectConflict(m.content, fact.value));
          if (conflicting) {
            evidence += ` | CONFLICT: existing memory ${conflicting.id} has "${conflicting.content}", new value is "${fact.value}"`;
          }
        } catch {
          // Best-effort conflict detection — don't block proposal on recall failure
        }

        await svc.propose({
          workspaceId: row.workspaceId,
          agentId: row.agentId,
          type: fact.scope === 'user' ? 'reference' : 'domain',
          title: fact.key,
          content: String(fact.value),
          evidence,
          sessionId: row.sessionId ?? undefined,
        });
        proposed++;
      }

      logger.info(
        { taskId, factsFound: facts.length, proposed },
        'Auto memory extraction completed',
      );
    } catch (err) {
      logger.error(
        { taskId, error: err instanceof Error ? err.message : String(err) },
        'Auto memory extraction failed',
      );
    }
  });
}
