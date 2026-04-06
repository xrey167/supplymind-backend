import { ok, err } from '../../core/result';
import type { Result } from '../../core/result';
import { promptsRepo, type PromptsRepository } from './prompts.repo';
import type { Prompt, CreatePromptInput, UpdatePromptInput, PromptVariable } from './prompts.types';

export class PromptsService {
  constructor(private repo: PromptsRepository = promptsRepo) {}

  /** Extract {{variable_name}} patterns from content */
  extractVariables(content: string): PromptVariable[] {
    const regex = /\{\{(\w+)\}\}/g;
    const seen = new Set<string>();
    const variables: PromptVariable[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1]!;
      if (!seen.has(name)) {
        seen.add(name);
        variables.push({ name });
      }
    }
    return variables;
  }

  async create(input: CreatePromptInput): Promise<Result<Prompt>> {
    // Auto-extract variables from content, merge with any explicitly provided
    const extracted = this.extractVariables(input.content);
    const explicitMap = new Map((input.variables ?? []).map(v => [v.name, v]));

    const variables = extracted.map(v => explicitMap.get(v.name) ?? v);
    // Add any explicit variables not found in content
    for (const v of input.variables ?? []) {
      if (!extracted.some(e => e.name === v.name)) {
        variables.push(v);
      }
    }

    const prompt = await this.repo.create({ ...input, variables });
    return ok(prompt);
  }

  async get(id: string): Promise<Result<Prompt>> {
    const prompt = await this.repo.findById(id);
    if (!prompt) return err(new Error(`Prompt not found: ${id}`));
    return ok(prompt);
  }

  async list(workspaceId: string, filter?: { tag?: string; isActive?: boolean; limit?: number; offset?: number }): Promise<Prompt[]> {
    return this.repo.list(workspaceId, filter);
  }

  async update(id: string, input: UpdatePromptInput): Promise<Result<Prompt>> {
    const existing = await this.repo.findById(id);
    if (!existing) return err(new Error(`Prompt not found: ${id}`));

    // If content changed, create a new version instead of updating in-place
    if (input.content && input.content !== existing.content) {
      const variables = input.variables ?? this.mergeVariables(
        existing.variables,
        this.extractVariables(input.content),
      );

      const newPrompt = await this.repo.create({
        workspaceId: existing.workspaceId,
        name: input.name ?? existing.name,
        description: input.description ?? existing.description ?? undefined,
        content: input.content,
        variables,
        tags: input.tags ?? existing.tags,
        createdBy: existing.createdBy ?? undefined,
        version: existing.version + 1,
      });

      // Deactivate old version
      await this.repo.update(id, { isActive: false });

      return ok(newPrompt);
    }

    // No content change — update in-place
    const updated = await this.repo.update(id, input);
    return ok(updated);
  }

  async delete(id: string): Promise<Result<void>> {
    const deleted = await this.repo.delete(id);
    if (!deleted) return err(new Error(`Prompt not found: ${id}`));
    return ok(undefined);
  }

  async render(promptId: string, variables: Record<string, string>): Promise<Result<string>> {
    const prompt = await this.repo.findById(promptId);
    if (!prompt) return err(new Error(`Prompt not found: ${promptId}`));

    let rendered = prompt.content;
    for (const v of prompt.variables) {
      const value = variables[v.name] ?? v.default;
      if (value !== undefined) {
        rendered = rendered.replaceAll(`{{${v.name}}}`, value);
      }
    }

    return ok(rendered);
  }

  private mergeVariables(existing: PromptVariable[], extracted: PromptVariable[]): PromptVariable[] {
    const existingMap = new Map(existing.map(v => [v.name, v]));
    return extracted.map(v => existingMap.get(v.name) ?? v);
  }
}

export const promptsService = new PromptsService();
