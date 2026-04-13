export type FlagValue = boolean | string | number;

export const DEFAULT_FLAGS: Record<string, FlagValue> = {
  'computer-use.enabled': false,
  'agent.max-iterations': 50,
  'agent.allow-parallel-tool-use': true,
  'orchestration.max-parallel-steps': 10,
  'billing.enforce-quota': false,
  'billing.monthly-cost-limit-usd': 100,
  'memory.vector-search': true,
  'memory.auto-proposal': true,
  'sessions.max-active': 20,
  'sessions.context-compaction': true,
  'mcp.allow-external-servers': true,
  'observability.detailed-logging': false,
  'plugins.platform.enabled': false,
  'plugins.local_sandboxed.enabled': false,
  'intent_gate.enabled': false,
  'intent_gate.llm_fallback': false,
  'erp_bc.enabled': false,
  'erp_bc.write_actions.enabled': false,
  'learning.generativeExtension': false,
};
