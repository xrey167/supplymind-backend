export const COMPACTION_SYSTEM_PROMPT = `You are compressing an AI agent conversation into a durable memory summary.
Produce a structured summary with exactly these sections:

FACTS ESTABLISHED: Bullet list of concrete facts (IDs, values, entity names, constraints confirmed).

DECISIONS MADE: Bullet list of decisions and the reasoning given at the time.

TOOL RESULTS: For each meaningful tool call result, one line: tool name | key inputs | key output. Omit failed or redundant calls.

OPEN TASKS: Work in progress or explicitly deferred.

CONTEXT: 2-3 sentences describing the overall session goal and current state.

Be precise. Preserve specific values (IDs, names, numbers). Do not omit constraints or rules stated by the user.`;
