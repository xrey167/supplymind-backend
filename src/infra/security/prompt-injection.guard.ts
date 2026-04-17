export type InjectionSeverity = 'low' | 'medium' | 'high';

export interface InjectionDetection {
  pattern: string;
  severity: InjectionSeverity;
  match: string;
}

export interface InjectionScanResult {
  flagged: boolean;
  /** true when any detection reaches 'high' severity — signals the middleware to block */
  shouldBlock: boolean;
  detections: InjectionDetection[];
}

interface PatternRule {
  name: string;
  pattern: RegExp;
  severity: InjectionSeverity;
}

const SEVERITY_SCORE: Record<InjectionSeverity, number> = { low: 1, medium: 2, high: 3 };
const BLOCK_THRESHOLD = 3; // 'high' only

const PATTERNS: PatternRule[] = [
  { name: 'system_override_inline',       pattern: /\bsystem\s*:\s*override\b/i,                                               severity: 'high' },
  { name: 'markdown_system_block',        pattern: /```+\s*system\b/i,                                                          severity: 'high' },
  { name: 'ignore_previous_instructions', pattern: /ignore\s+(your\s+)?(previous|prior)\s+instructions?/i,                     severity: 'high' },
  { name: 'disregard_instructions',       pattern: /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/i,             severity: 'high' },
  { name: 'new_system_prompt',            pattern: /your\s+new\s+system\s+prompt\s+is/i,                                       severity: 'high' },
  { name: 'role_switch_attempt',          pattern: /you\s+are\s+now\s+(dan|jailbreak|unrestricted|without\s+restrictions)/i,   severity: 'medium' },
  { name: 'jailbreak_pretend',            pattern: /pretend\s+(you\s+)?(have\s+no|don.t\s+have)\s+(content\s+policy|restrictions?|guidelines?|rules?)/i, severity: 'medium' },
  { name: 'act_as_unrestricted',          pattern: /act\s+as\s+(if\s+you\s+)?(are\s+)?(unrestricted|without\s+(any\s+)?rules?|a\s+jailbroken)/i, severity: 'medium' },
];

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'object' && part !== null && 'text' in part
          ? String((part as Record<string, unknown>).text)
          : '',
      )
      .join('\n');
  }
  return '';
}

export function scanMessages(
  messages: Array<{ role: string; content: unknown }>,
): InjectionScanResult {
  const combined = messages.map((m) => extractText(m.content)).join('\n');
  const detections: InjectionDetection[] = [];

  for (const rule of PATTERNS) {
    const match = combined.match(rule.pattern);
    if (match) {
      detections.push({
        pattern: rule.name,
        severity: rule.severity,
        match: match[0].slice(0, 80),
      });
    }
  }

  const flagged = detections.length > 0;
  const shouldBlock = detections.some((d) => SEVERITY_SCORE[d.severity] >= BLOCK_THRESHOLD);

  return { flagged, shouldBlock, detections };
}
