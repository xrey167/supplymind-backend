const SUMMARIZER_FLOOR = 'claude-haiku-4-5-20251001';

const MODEL_TIER_DOWN: Record<string, string> = {
  'claude-opus-4-6': 'claude-sonnet-4-6',
  'claude-sonnet-4-6': SUMMARIZER_FLOOR,
  'claude-haiku-4-5-20251001': SUMMARIZER_FLOOR,
};

export function resolveSummarizerModel(sessionModel: string): string {
  return MODEL_TIER_DOWN[sessionModel] ?? SUMMARIZER_FLOOR;
}
