import { ok, err } from '../result';
import type { GatewayRequest, GatewayResult, GatewayContext } from './gateway.types';
import type { DispatchContext } from '../../modules/skills/skills.types';
import { bridgeTaskEvents } from './gateway-stream';
import { NotFoundError } from '../errors';
import { logger } from '../../config/logger';
import { lifecycleHooks } from '../hooks/hook-registry';

/**
 * Unified capability gateway.
 *
 * Every protocol surface (WS, MCP, SSE, A2A HTTP) calls this single function.
 * It delegates to existing services — no business logic lives here.
 */
export async function execute(req: GatewayRequest): Promise<GatewayResult> {
  const { op, params, context } = req;

  switch (op) {
    // ------------------------------------------------------------------
    // Skills
    // ------------------------------------------------------------------
    case 'skill.list': {
      const { skillRegistry } = await import('../../modules/skills/skills.registry');
      return ok(skillRegistry.list().map((s) => ({
        name: s.name,
        description: s.description,
        inputSchema: s.inputSchema,
        providerType: s.providerType,
      })));
    }

    case 'skill.invoke': {
      const { dispatchSkill } = await import('../../modules/skills/skills.dispatch');
      const name = params.name as string;
      let args = (params.args ?? {}) as Record<string, unknown>;

      // Pre-tool hook — can block or modify args
      const hookCtx = { workspaceId: context.workspaceId, callerId: context.callerId, traceId: context.traceId };
      const preResult = await lifecycleHooks.run('pre_tool_use', { toolName: name, args, workspaceId: context.workspaceId }, hookCtx);
      if (!preResult.allow) {
        return err(new Error(preResult.reason ?? `Blocked by pre_tool_use hook`));
      }
      if (preResult.payload && typeof preResult.payload === 'object' && 'args' in (preResult.payload as any)) {
        args = (preResult.payload as any).args;
      }

      const result = await dispatchSkill(name, args, toDispatchCtx(context));

      // Post-tool hook — fire-and-forget notification
      lifecycleHooks.notify('post_tool_use', { toolName: name, args, result, workspaceId: context.workspaceId }, hookCtx);

      return result;
    }

    // ------------------------------------------------------------------
    // Tasks
    // ------------------------------------------------------------------
    case 'task.send': {
      const { tasksService } = await import('../../modules/tasks/tasks.service');
      const agentId = params.agentId as string;
      const message = params.message as string;
      const sessionId = params.sessionId as string | undefined;
      const runMode = (params.runMode as 'foreground' | 'background') ?? 'foreground';

      // Wire streaming if caller wants events
      let cleanup: (() => void) | undefined;
      const result = await tasksService.send(
        agentId, message, context.workspaceId, context.callerId,
        params.skillId as string | undefined,
        params.args as Record<string, unknown> | undefined,
        sessionId ?? context.sessionId,
        runMode,
      );

      if (result.ok && context.onEvent && 'id' in result.value) {
        cleanup = bridgeTaskEvents(result.value.id, context.onEvent);
        // Cleanup is handled automatically on terminal events by bridgeTaskEvents,
        // but also clean up if the caller's signal aborts.
        context.signal?.addEventListener('abort', () => cleanup?.(), { once: true });
      }

      return result;
    }

    case 'task.get': {
      const { tasksService } = await import('../../modules/tasks/tasks.service');
      const task = tasksService.get(params.id as string);
      return task ? ok(task) : err(new NotFoundError(`Task not found: ${params.id}`));
    }

    case 'task.cancel': {
      const { tasksService } = await import('../../modules/tasks/tasks.service');
      return tasksService.cancel(params.id as string, context.workspaceId);
    }

    case 'task.list': {
      const { tasksService } = await import('../../modules/tasks/tasks.service');
      const tasks = await tasksService.list(context.workspaceId);
      return ok(tasks);
    }

    case 'task.input': {
      const taskId = params.taskId as string;
      const input = params.input;

      // Route 1: tool approval response (with optional updatedInput)
      if (params.approvalId) {
        const { resolveApproval } = await import('../../infra/state/tool-approvals');
        const resolved = resolveApproval(
          params.approvalId as string,
          context.workspaceId,
          !!params.approved,
          params.updatedInput as Record<string, unknown> | undefined,
        );
        return resolved
          ? ok({ approvalId: params.approvalId, resolved: true })
          : err(new NotFoundError(`Approval not found or expired: ${params.approvalId}`));
      }

      // Route 2: orchestration gate response
      if (params.orchestrationId && params.stepId) {
        const { resolveGate } = await import('../../infra/state/orchestration-gates');
        const resolved = resolveGate(
          params.orchestrationId as string,
          params.stepId as string,
          context.workspaceId,
          !!params.approved,
          context.callerId,
        );
        return resolved
          ? ok({ orchestrationId: params.orchestrationId, stepId: params.stepId, resolved: true })
          : err(new NotFoundError(`Gate not found or expired: ${params.orchestrationId}:${params.stepId}`));
      }

      // Route 3: generic mid-task user input
      const { resolveInput } = await import('../../infra/state/task-inputs');
      const resolved = resolveInput(taskId, context.workspaceId, input);
      return resolved
        ? ok({ taskId, resolved: true })
        : err(new NotFoundError(`No pending input request for task: ${taskId}`));
    }

    case 'task.interrupt': {
      const { taskManager } = await import('../../infra/a2a/task-manager');
      const interrupted = taskManager.interrupt(params.id as string);
      return interrupted
        ? ok({ id: params.id, interrupted: true })
        : err(new NotFoundError(`Task not found or already terminal: ${params.id}`));
    }

    // ------------------------------------------------------------------
    // Agents
    // ------------------------------------------------------------------
    case 'agent.list': {
      const { agentsService } = await import('../../modules/agents/agents.service');
      const agents = await agentsService.list(context.workspaceId);
      return ok(agents);
    }

    case 'agent.invoke': {
      // Convenience op: resolves agentId and delegates to task.send
      return execute({
        op: 'task.send',
        params: {
          agentId: params.agentId,
          message: params.message,
          sessionId: params.sessionId,
          runMode: params.runMode ?? 'foreground',
        },
        context,
      });
    }

    // ------------------------------------------------------------------
    // Sessions
    // ------------------------------------------------------------------
    case 'session.create': {
      const { sessionsService } = await import('../../modules/sessions/sessions.service');
      const session = await sessionsService.create(params as any);
      return ok(session);
    }

    case 'session.resume': {
      const { sessionsService } = await import('../../modules/sessions/sessions.service');
      const sessionId = params.sessionId as string;
      await sessionsService.resume(sessionId);
      if (params.input) {
        await sessionsService.addMessage(sessionId, {
          role: 'user',
          content: typeof params.input === 'string' ? params.input : JSON.stringify(params.input),
        });
      }
      return ok({ sessionId, resumed: true });
    }

    case 'session.addMessage': {
      const { sessionsService } = await import('../../modules/sessions/sessions.service');
      const msg = await sessionsService.addMessage(
        params.sessionId as string,
        params as any,
      );
      return ok(msg);
    }

    // ------------------------------------------------------------------
    // Memory
    // ------------------------------------------------------------------
    case 'memory.approve': {
      const { memoryService } = await import('../../modules/memory/memory.service');
      await memoryService.approveProposal(params.proposalId as string, context.workspaceId);
      return ok({ proposalId: params.proposalId, approved: true });
    }

    case 'memory.reject': {
      const { memoryService } = await import('../../modules/memory/memory.service');
      await memoryService.rejectProposal(params.proposalId as string, context.workspaceId, params.reason as string | undefined);
      return ok({ proposalId: params.proposalId, rejected: true });
    }

    // ------------------------------------------------------------------
    // Orchestration
    // ------------------------------------------------------------------
    case 'orchestration.start': {
      const { orchestrationService } = await import('../../modules/orchestration/orchestration.service');
      const record = await orchestrationService.create({
        workspaceId: context.workspaceId,
        sessionId: params.sessionId as string | undefined,
        name: params.name as string | undefined,
        definition: params.definition as any,
        input: params.input as Record<string, unknown> | undefined,
      });
      const result = await orchestrationService.run(
        record.id,
        context.workspaceId,
        params.definition as any,
        params.input as Record<string, unknown>,
        params.onGate as any,
      );
      return ok(result);
    }

    case 'orchestration.gate.respond': {
      const { resolveGate } = await import('../../infra/state/orchestration-gates');
      const resolved = resolveGate(
        params.orchestrationId as string,
        params.stepId as string,
        context.workspaceId,
        !!params.approved,
        context.callerId,
      );
      return resolved
        ? ok({ orchestrationId: params.orchestrationId, stepId: params.stepId, resolved: true })
        : err(new NotFoundError(`Gate not found or expired: ${params.orchestrationId}:${params.stepId}`));
    }

    // ------------------------------------------------------------------
    // A2A Delegation (outbound to external agents)
    // ------------------------------------------------------------------
    case 'a2a.delegate': {
      const { workerRegistry } = await import('../../infra/a2a/worker-registry');
      const agentUrl = params.agentUrl as string;
      const result = await workerRegistry.delegate(agentUrl, {
        skillId: params.skillId as string | undefined,
        args: params.args as Record<string, unknown> | undefined,
        message: params.message as any,
      });
      return ok(result);
    }

    // ------------------------------------------------------------------
    // Collaboration
    // ------------------------------------------------------------------
    case 'collaboration.start': {
      const { collaborate } = await import('../../modules/collaboration/collaboration.engine');
      const { dispatchSkill } = await import('../../modules/skills/skills.dispatch');
      const dispatchCtx = toDispatchCtx(context);
      const dispatch = async (agentId: string, args: Record<string, unknown>): Promise<string> => {
        const r = await dispatchSkill(agentId, args, dispatchCtx);
        if (!r.ok) throw new Error(r.error instanceof Error ? r.error.message : String(r.error));
        return typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
      };
      const result = await collaborate(params as any, dispatch);
      return ok(result);
    }


    case 'plan.create': {
      const { executionService } = await import('../../modules/execution/execution.service');
      return executionService.create(
        context.workspaceId,
        context.callerId,
        { name: params.name as string | undefined, steps: params.steps as any[], input: params.input as Record<string,unknown> | undefined, policy: params.policy as any },
      );
    }
    case 'plan.run': {
      const { executionService } = await import('../../modules/execution/execution.service');
      const id = params.id as string;
      if (!id) return err(new Error('id is required'));
      return executionService.run(context.workspaceId, id, context.callerId);
    }
    case 'plan.approve': {
      const { executionService } = await import('../../modules/execution/execution.service');
      const id = params.id as string;
      if (!id) return err(new Error('id is required'));
      return executionService.approve(context.workspaceId, id, context.callerId);
    }
    case 'plan.get': {
      const { executionService } = await import('../../modules/execution/execution.service');
      const id = params.id as string;
      if (!id) return err(new Error('id is required'));
      const plan = await executionService.get(context.workspaceId, id);
      return plan ? ok(plan) : err(new NotFoundError('Plan not found: ' + id));
    }

    default: {
      const { pluginContributionRegistry } = await import('../../modules/plugins/plugin-contribution-registry');
      const registered = pluginContributionRegistry.getGatewayOps().find(g => g.op === op);
      if (registered) return registered.handler(req);
      return err(new Error(`Unknown gateway op: ${op}`));
    }
  }
}

/** Convert GatewayContext → DispatchContext for skill dispatch */
function toDispatchCtx(ctx: GatewayContext): DispatchContext {
  return {
    callerId: ctx.callerId,
    workspaceId: ctx.workspaceId,
    callerRole: ctx.callerRole,
    traceId: ctx.traceId,
    signal: ctx.signal,
  };
}
