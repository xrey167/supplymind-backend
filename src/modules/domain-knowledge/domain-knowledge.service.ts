/**
 * Domain Knowledge Service
 *
 * Manages per-plugin domain knowledge graphs. Seeded from PluginManifest.domain
 * on plugin install, then continuously refined by the domain extractor as tasks complete.
 */

import { db } from '../../infra/db/client';
import { domainKnowledgeGraphs } from '../../infra/db/schema';
import { eq, and } from 'drizzle-orm';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { logger } from '../../config/logger';
import type { DomainSchema, DomainEntity, VocabularyTerm, DomainRule } from '../plugins/plugin-manifest';

export interface DomainKnowledgeGraph {
  id: string;
  pluginId: string;
  workspaceId: string;
  entityGraph: DomainEntity[];
  vocabulary: VocabularyTerm[];
  rules: DomainRule[];
  confidenceScores: Record<string, number>;
  version: number;
  lastUpdated: Date;
}

export interface DomainKeywords {
  primaryActions: string[];
  riskTerms: string[];
}

export class DomainKnowledgeService {
  /**
   * Seed domain knowledge from a plugin manifest on install.
   */
  async seed(pluginId: string, workspaceId: string, domain: DomainSchema): Promise<void> {
    const existing = await db
      .select({ id: domainKnowledgeGraphs.id })
      .from(domainKnowledgeGraphs)
      .where(and(
        eq(domainKnowledgeGraphs.pluginId, pluginId),
        eq(domainKnowledgeGraphs.workspaceId, workspaceId),
      ))
      .limit(1);

    if (existing.length > 0) {
      // Update with seeded values (install may be a re-install)
      await db
        .update(domainKnowledgeGraphs)
        .set({
          entityGraph: domain.entities as any,
          vocabulary: domain.vocabulary as any,
          rules: domain.rules as any,
          version: 1,
          lastUpdated: new Date(),
        })
        .where(and(
          eq(domainKnowledgeGraphs.pluginId, pluginId),
          eq(domainKnowledgeGraphs.workspaceId, workspaceId),
        ));
    } else {
      await db.insert(domainKnowledgeGraphs).values({
        pluginId,
        workspaceId,
        entityGraph: domain.entities as any,
        vocabulary: domain.vocabulary as any,
        rules: domain.rules as any,
        confidenceScores: {},
        version: 1,
      });
    }

    await eventBus.publish(Topics.DOMAIN_KNOWLEDGE_SEEDED, {
      pluginId,
      workspaceId,
      entityCount: domain.entities.length,
      vocabularyCount: domain.vocabulary.length,
    }, { source: 'domain-knowledge' });

    logger.info({ pluginId, workspaceId, entities: domain.entities.length }, 'Domain knowledge seeded');
  }

  /**
   * Update the knowledge graph from live observation (called by domain-extractor).
   */
  async updateFromObservation(
    pluginId: string,
    workspaceId: string,
    updates: {
      newEntities?: DomainEntity[];
      newVocabulary?: VocabularyTerm[];
      confidenceUpdates?: Record<string, number>;
    },
  ): Promise<void> {
    const rows = await db
      .select()
      .from(domainKnowledgeGraphs)
      .where(and(
        eq(domainKnowledgeGraphs.pluginId, pluginId),
        eq(domainKnowledgeGraphs.workspaceId, workspaceId),
      ))
      .limit(1);

    if (rows.length === 0) return; // No graph yet — extractor fires before install

    const row = rows[0]!;
    const existingEntities = (row.entityGraph as DomainEntity[]) ?? [];
    const existingVocab = (row.vocabulary as VocabularyTerm[]) ?? [];
    const existingScores = (row.confidenceScores as Record<string, number>) ?? {};

    // Merge new entities (by name, avoid duplicates)
    const entityNames = new Set(existingEntities.map((e) => e.name.toLowerCase()));
    const mergedEntities = [...existingEntities];
    for (const entity of updates.newEntities ?? []) {
      if (!entityNames.has(entity.name.toLowerCase())) {
        mergedEntities.push(entity);
      }
    }

    // Merge new vocabulary (by term, avoid duplicates)
    const existingTerms = new Set(existingVocab.map((v) => v.term.toLowerCase()));
    const mergedVocab = [...existingVocab];
    for (const term of updates.newVocabulary ?? []) {
      if (!existingTerms.has(term.term.toLowerCase())) {
        mergedVocab.push(term);
      }
    }

    const mergedScores = { ...existingScores, ...updates.confidenceUpdates };

    await db
      .update(domainKnowledgeGraphs)
      .set({
        entityGraph: mergedEntities as any,
        vocabulary: mergedVocab as any,
        confidenceScores: mergedScores as any,
        version: row.version + 1,
        lastUpdated: new Date(),
      })
      .where(eq(domainKnowledgeGraphs.id, row.id));

    await eventBus.publish(Topics.DOMAIN_KNOWLEDGE_UPDATED, {
      pluginId,
      workspaceId,
      changesCount: (updates.newEntities?.length ?? 0) + (updates.newVocabulary?.length ?? 0),
      version: row.version + 1,
    }, { source: 'domain-knowledge' });
  }

  /**
   * Get the domain knowledge graph for a specific plugin installation.
   */
  async get(pluginId: string, workspaceId: string): Promise<DomainKnowledgeGraph | null> {
    const rows = await db
      .select()
      .from(domainKnowledgeGraphs)
      .where(and(
        eq(domainKnowledgeGraphs.pluginId, pluginId),
        eq(domainKnowledgeGraphs.workspaceId, workspaceId),
      ))
      .limit(1);

    if (rows.length === 0) return null;
    const row = rows[0]!;
    return {
      id: row.id,
      pluginId: row.pluginId,
      workspaceId: row.workspaceId,
      entityGraph: (row.entityGraph as DomainEntity[]) ?? [],
      vocabulary: (row.vocabulary as VocabularyTerm[]) ?? [],
      rules: (row.rules as DomainRule[]) ?? [],
      confidenceScores: (row.confidenceScores as Record<string, number>) ?? {},
      version: row.version,
      lastUpdated: row.lastUpdated,
    };
  }

  /**
   * Get all graphs for a workspace (across all installed plugins).
   */
  async listForWorkspace(workspaceId: string): Promise<DomainKnowledgeGraph[]> {
    const rows = await db
      .select()
      .from(domainKnowledgeGraphs)
      .where(eq(domainKnowledgeGraphs.workspaceId, workspaceId));

    return rows.map((row: typeof rows[number]) => ({
      id: row.id,
      pluginId: row.pluginId,
      workspaceId: row.workspaceId,
      entityGraph: (row.entityGraph as DomainEntity[]) ?? [],
      vocabulary: (row.vocabulary as VocabularyTerm[]) ?? [],
      rules: (row.rules as DomainRule[]) ?? [],
      confidenceScores: (row.confidenceScores as Record<string, number>) ?? {},
      version: row.version,
      lastUpdated: row.lastUpdated,
    }));
  }

  /**
   * Get merged domain keywords across all active plugins for a workspace.
   * Used by the domain-aware model router.
   */
  async getDomainKeywords(workspaceId: string): Promise<DomainKeywords> {
    const rows = await db
      .select({
        entityGraph: domainKnowledgeGraphs.entityGraph,
        vocabulary: domainKnowledgeGraphs.vocabulary,
      })
      .from(domainKnowledgeGraphs)
      .where(eq(domainKnowledgeGraphs.workspaceId, workspaceId));

    const primaryActions: string[] = [];
    const riskTerms: string[] = [];

    // Entity names and their aliases become domain keywords (→ BALANCED)
    for (const row of rows) {
      const entities = (row.entityGraph as DomainEntity[]) ?? [];
      for (const entity of entities) {
        primaryActions.push(entity.name.toLowerCase());
        for (const alias of entity.aliases ?? []) {
          primaryActions.push(alias.toLowerCase());
        }
      }
      const vocab = (row.vocabulary as VocabularyTerm[]) ?? [];
      for (const term of vocab) {
        if (term.category === 'risk') {
          riskTerms.push(term.term.toLowerCase());
        } else {
          primaryActions.push(term.term.toLowerCase());
        }
      }
    }

    return { primaryActions: [...new Set(primaryActions)], riskTerms: [...new Set(riskTerms)] };
  }

  /** Remove domain knowledge when a plugin is uninstalled. */
  async remove(pluginId: string, workspaceId: string): Promise<void> {
    await db
      .delete(domainKnowledgeGraphs)
      .where(and(
        eq(domainKnowledgeGraphs.pluginId, pluginId),
        eq(domainKnowledgeGraphs.workspaceId, workspaceId),
      ));
  }
}

export const domainKnowledgeService = new DomainKnowledgeService();
