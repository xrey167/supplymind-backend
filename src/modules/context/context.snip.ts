import type { Message } from '../../infra/ai/types';
import { estimateTokens } from './context.tracker';

interface SnipConfig {
  toolResultMaxTokens: number;
  toolResultMaxAge: number;
  toolResultKeepTokens: number;
  bashMaxTokens: number;
  bashMaxAge: number;
  bashKeepTokens: number;
}

const DEFAULT_SNIP_CONFIG: SnipConfig = {
  toolResultMaxTokens: 500,
  toolResultMaxAge: 3,
  toolResultKeepTokens: 200,
  bashMaxTokens: 300,
  bashMaxAge: 2,
  bashKeepTokens: 150,
};

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 3;
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return text.slice(0, half) + '\n\n[...truncated...]\n\n' + text.slice(-half);
}

export function snipMessages(
  messages: Message[],
  currentTurn: number,
  config: Partial<SnipConfig> = {},
): Message[] {
  const cfg = { ...DEFAULT_SNIP_CONFIG, ...config };

  return messages.map((msg, idx) => {
    const age = currentTurn - idx;
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    const tokens = estimateTokens(content);

    if (msg.role === 'tool' && tokens > cfg.toolResultMaxTokens && age > cfg.toolResultMaxAge) {
      return { ...msg, content: truncateToTokens(content, cfg.toolResultKeepTokens) };
    }

    if (msg.role === 'assistant' && tokens > cfg.bashMaxTokens && age > cfg.bashMaxAge) {
      if (tokens > 1000) {
        return { ...msg, content: truncateToTokens(content, cfg.bashKeepTokens) };
      }
    }

    return msg;
  });
}
