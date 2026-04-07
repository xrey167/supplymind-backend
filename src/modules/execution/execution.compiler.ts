import type { ExecutionStep } from './execution.types';
import type { OrchestrationDefinition } from '../orchestration/orchestration.types';

/**
 * Compile ExecutionStep[] → OrchestrationDefinition.
 * Strips execution-only fields: riskClass, approvalMode, pluginId, capabilityId.
 */
export function compileToOrchestration(
  steps: ExecutionStep[],
  maxConcurrency?: number,
): OrchestrationDefinition {
  const orchestrationSteps = steps.map((step) => {
    const { riskClass: _r, approvalMode: _a, pluginId: _p, capabilityId: _c, ...orchStep } = step as any;
    return orchStep;
  });

  return {
    steps: orchestrationSteps,
    ...(maxConcurrency !== undefined && { maxConcurrency }),
  };
}
