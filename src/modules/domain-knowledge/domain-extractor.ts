/**
 * Domain Extractor — event consumer
 *
 * Subscribes to TASK_COMPLETED, scans the task transcript for domain entity
 * mentions, and refines the domain knowledge graph via live observation.
 *
 * Mirrors the pattern in src/events/consumers/memory-extraction.handler.ts.
 */

import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { taskRepo } from '../../infra/a2a/task-repo';
import { domainKnowledgeService } from './domain-knowledge.service';
import { logger } from '../../config/logger';
import type { DomainEntity, VocabularyTerm } from '../plugins/plugin-manifest';

const MIN_MENTION_CONFIDENCE = 0.6;

let registered = false;

export function _resetDomainExtractionHandler() {
  registered = false;
}

export function initDomainExtractionHandler(
  bus = eventBus,
  repo: Pick<typeof taskRepo, 'findRawById'> = taskRepo,
) {
  if (registered) return;
  registered = true;

  bus.subscribe(Topics.TASK_COMPLETED, async (event) => {
    const { taskId } = event.data as { taskId: string };

    try {
      const row = await repo.findRawById(taskId);
      if (!row) return;

      const history = (row.history as Array<{ role: string; parts: Array<{ kind: string; text?: string }> }>) ?? [];
      if (history.length === 0) return;

      // Collect all text from transcript
      const fullText = history
        .flatMap((msg) => msg.parts)
        .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text' && !!p.text)
        .map((p) => p.text)
        .join('\n')
        .toLowerCase();

      if (!fullText) return;

      // Fetch existing knowledge graphs for this workspace
      const graphs = await domainKnowledgeService.listForWorkspace(row.workspaceId);
      if (graphs.length === 0) return;

      for (const graph of graphs) {
        const newEntities: DomainEntity[] = [];
        const newVocabulary: VocabularyTerm[] = [];
        const confidenceUpdates: Record<string, number> = {};

        // Check which known entities are mentioned → raise their confidence
        for (const entity of graph.entityGraph) {
          const names = [entity.name, ...(entity.aliases ?? [])].map((n) => n.toLowerCase());
          const mentioned = names.some((n) => fullText.includes(n));
          if (mentioned) {
            const key = `entity:${entity.name}`;
            const current = graph.confidenceScores[key] ?? 0.5;
            confidenceUpdates[key] = Math.min(1.0, current + 0.05);
          }
        }

        // Check vocabulary terms for mentions
        for (const term of graph.vocabulary) {
          if (fullText.includes(term.term.toLowerCase())) {
            const key = `vocab:${term.term}`;
            const current = graph.confidenceScores[key] ?? 0.5;
            confidenceUpdates[key] = Math.min(1.0, current + 0.03);
          }
        }

        if (Object.keys(confidenceUpdates).length > 0 || newEntities.length > 0 || newVocabulary.length > 0) {
          await domainKnowledgeService.updateFromObservation(
            graph.pluginId,
            row.workspaceId,
            { newEntities, newVocabulary, confidenceUpdates },
          );
        }
      }

      logger.info({ taskId, workspaceId: row.workspaceId, graphs: graphs.length }, 'Domain extraction completed');
    } catch (err) {
      logger.error(
        { taskId, error: err instanceof Error ? err.message : String(err) },
        'Domain extraction failed',
      );
    }
  });
}
