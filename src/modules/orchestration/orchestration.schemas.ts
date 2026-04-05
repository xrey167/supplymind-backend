import { z } from 'zod';

const stepSchema = z.object({
  id: z.string(),
  type: z.enum(['skill', 'agent', 'collaboration', 'gate', 'decision']),
  skillId: z.string().optional(),
  args: z.record(z.unknown()).optional(),
  agentId: z.string().optional(),
  message: z.string().optional(),
  strategy: z.enum(['fan_out', 'consensus', 'debate', 'map_reduce']).optional(),
  agentIds: z.array(z.string()).optional(),
  gatePrompt: z.string().optional(),
  timeout: z.number().optional(),
  dependsOn: z.array(z.string()).optional(),
  onError: z.enum(['fail', 'skip', 'retry']).optional(),
  maxRetries: z.number().optional(),
  when: z.string().regex(
    /^[^{}]*(\$\{[^}]+\}[^{}]*)*\s*(>=|<=|>|<|===|!==|==|!=)\s*.+$|^\$\{[^}]+\}$/,
    'when must be a template expression (${steps.id.result}) or comparison (${steps.id.result.field} > value)',
  ).optional(),
  label: z.string().optional(),
});

export const createOrchestrationSchema = z.object({
  name: z.string().optional(),
  definition: z.object({
    steps: z.array(stepSchema),
    maxConcurrency: z.number().optional(),
  }),
  input: z.record(z.unknown()).optional(),
  sessionId: z.string().uuid().optional(),
});
