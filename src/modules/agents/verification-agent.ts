export type VerificationOutcome = 'PASS' | 'FAIL' | 'PARTIAL' | 'UNKNOWN';

export interface VerificationVerdict {
  outcome: VerificationOutcome;
  detail: string;
  rawOutput: string;
}

export interface VerificationInput {
  originalTask: string;
  filesChanged: string[];
  approach: string;
  additionalContext?: string;
}

/**
 * Builds the system prompt for the adversarial verification agent.
 *
 * The verification agent tries to BREAK the implementation, not confirm it.
 * It must run real commands and observe actual output — no assumptions.
 * It always ends with a structured VERDICT: PASS | FAIL | PARTIAL line.
 */
export function buildVerificationPrompt(input: VerificationInput): string {
  return `You are an adversarial verification agent. Your job is to BREAK this implementation, not confirm it.

## Original Task
${input.originalTask}

## Files Changed
${input.filesChanged.map(f => `- ${f}`).join('\n')}

## Approach Taken
${input.approach}
${input.additionalContext ? `\n## Additional Context\n${input.additionalContext}` : ''}

## Your Verification Protocol

1. **Read every changed file** — understand what was implemented
2. **Run the actual code** — no assumptions about what it does
3. **Probe adversarially** — try these attack vectors:
   - Boundary values (empty input, null, max length, negative numbers)
   - Concurrent calls (what happens if called twice simultaneously?)
   - Idempotency (does running it twice break state?)
   - Error paths (what if a dependency fails mid-execution?)
   - Orphan operations (are there side effects that aren't cleaned up?)
4. **Check every requirement** from the original task — not just the happy path

## Output Format

Write your findings, then end with exactly:

VERDICT: PASS
(or VERDICT: FAIL, or VERDICT: PARTIAL)

Followed by a one-sentence summary of the most important finding.`;
}

/**
 * Parses the structured VERDICT line from verification agent output.
 */
export function parseVerificationVerdict(output: string): VerificationVerdict {
  const match = output.match(/VERDICT:\s*(PASS|FAIL|PARTIAL)\s*\n?(.+)?/i);
  if (!match) {
    return { outcome: 'UNKNOWN', detail: 'No verdict found in output', rawOutput: output };
  }
  const outcome = match[1].toUpperCase() as VerificationOutcome;
  const detail = (match[2] ?? '').trim();
  return { outcome, detail, rawOutput: output };
}

export const VERIFICATION_AGENT_DEFINITION = {
  agentType: 'verification',
  whenToUse: 'After implementing any feature, bug fix, or refactor — to adversarially verify correctness before marking complete.',
  isReadOnly: true,
  allowedTools: ['Bash', 'Read', 'Glob', 'Grep'],
  model: 'claude-sonnet-4-6',
  buildSystemPrompt: buildVerificationPrompt,
} as const;
