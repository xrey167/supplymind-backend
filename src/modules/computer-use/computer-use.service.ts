import { ok, err } from '../../core/result';
import { AppError } from '../../core/errors';
import { logger } from '../../config/logger';
import { sessionManager } from './computer-use.session';
import {
  handleComputerAction,
  handleBashAction,
  handleTextEditorAction,
  buildComputerToolDef,
  buildBashToolDef,
  buildTextEditorToolDef,
  TEXT_EDITOR_NAME,
} from './computer-use.tools';
import { AnthropicRawRuntime } from '../../infra/ai/anthropic';
import type { Message } from '../../infra/ai/types';
import type { Result } from '../../core/result';
import type { CreateSessionInput, RunTaskInput } from './computer-use.schemas';

const MAX_ITERATIONS = 50;

export const computerUseService = {
  async createSession(workspaceId: string, input: CreateSessionInput) {
    try {
      const session = await sessionManager.create(workspaceId, {
        viewportWidth: input.viewportWidth,
        viewportHeight: input.viewportHeight,
      });
      return ok({
        sessionId: session.id,
        viewportWidth: session.viewportWidth,
        viewportHeight: session.viewportHeight,
        createdAt: session.createdAt.toISOString(),
      });
    } catch (error) {
      logger.error({ workspaceId, error: error instanceof Error ? error.message : String(error) }, 'Failed to create computer use session');
      return err(error instanceof Error ? error : new AppError(String(error), 500, 'INTERNAL_ERROR'));
    }
  },

  async destroySession(sessionId: string, workspaceId: string): Promise<Result<void>> {
    const session = sessionManager.get(sessionId);
    if (!session) return err(new AppError('Session not found', 404, 'NOT_FOUND'));
    if (session.workspaceId !== workspaceId) return err(new AppError('Session not found', 404, 'NOT_FOUND'));
    await sessionManager.destroy(sessionId);
    return ok(undefined);
  },

  listSessions(workspaceId: string) {
    return ok(sessionManager.listForWorkspace(workspaceId));
  },

  async screenshot(sessionId: string, workspaceId: string): Promise<Result<Buffer>> {
    const session = sessionManager.get(sessionId);
    if (!session) return err(new AppError('Session not found', 404, 'NOT_FOUND'));
    if (session.workspaceId !== workspaceId) return err(new AppError('Session not found', 404, 'NOT_FOUND'));
    try {
      const buf = await session.page.screenshot({ type: 'png' });
      return ok(buf);
    } catch (error) {
      logger.error({ sessionId, error: error instanceof Error ? error.message : String(error) }, 'Screenshot failed');
      return err(error instanceof Error ? error : new AppError(String(error), 500, 'INTERNAL_ERROR'));
    }
  },

  async runTask(sessionId: string, workspaceId: string, input: RunTaskInput): Promise<Result<{ output: string; iterations: number }>> {
    const session = sessionManager.get(sessionId);
    if (!session) return err(new AppError('Session not found', 404, 'NOT_FOUND'));
    if (session.workspaceId !== workspaceId) return err(new AppError('Session not found', 404, 'NOT_FOUND'));

    const runtime = new AnthropicRawRuntime();
    const tools = [
      buildComputerToolDef(sessionId, session.viewportWidth, session.viewportHeight),
      buildBashToolDef(sessionId),
      buildTextEditorToolDef(sessionId),
    ];

    const messages: Message[] = [{ role: 'user', content: input.task }];
    const maxIter = Math.min(input.maxIterations, MAX_ITERATIONS);
    let iterations = 0;
    let finalOutput = '';

    for (let i = 0; i < maxIter; i++) {
      iterations++;
      const result = await runtime.run({
        model: input.model,
        messages,
        tools,
        maxTokens: 4096,
        disableParallelToolUse: true, // CUA works better sequentially
      });

      if (!result.ok) return err(result.error);

      const { content, toolCalls, stopReason } = result.value;

      // Build assistant message content with text + tool_use blocks
      const assistantContent: Array<{ type: string; [key: string]: unknown }> = [];
      if (content) {
        assistantContent.push({ type: 'text', text: content });
        finalOutput = content;
      }
      if (toolCalls?.length) {
        for (const tc of toolCalls) {
          assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args });
        }
      }
      messages.push({ role: 'assistant', content: assistantContent as any });

      if (stopReason === 'end_turn' || !toolCalls?.length) break;

      // Execute each tool call and append results
      for (const tc of toolCalls) {
        let toolResult: Result<unknown>;

        if (tc.name === 'computer') {
          toolResult = await handleComputerAction(sessionId, tc.args);
        } else if (tc.name === 'bash') {
          toolResult = await handleBashAction(sessionId, tc.args);
        } else if (tc.name === TEXT_EDITOR_NAME) {
          toolResult = await handleTextEditorAction(sessionId, tc.args);
        } else {
          toolResult = err(new AppError(`Unknown tool: ${tc.name}`, 400, 'INVALID_INPUT'));
        }

        const resultContent = toolResult.ok ? toolResult.value : `Error: ${toolResult.error.message}`;

        messages.push({
          role: 'tool',
          toolCallId: tc.id,
          content: Array.isArray(resultContent) ? resultContent as any : String(resultContent),
        });

        if (!toolResult.ok) {
          logger.warn({ sessionId, tool: tc.name, error: toolResult.error.message }, 'Computer use tool failed');
        } else {
          logger.debug({ sessionId, tool: tc.name }, 'Computer use tool executed');
        }
      }
    }

    return ok({ output: finalOutput, iterations });
  },
};
