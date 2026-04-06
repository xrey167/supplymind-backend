import { nanoid } from 'nanoid';

export interface TranscriptMessage {
  id: string;
  parentMessageId: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface TranscriptEntry {
  role: TranscriptMessage['role'];
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Linked-list transcript chain for a session.
 * Each message has a parentMessageId pointer, enabling:
 *   - Audit trails  — full history with causal links
 *   - Forking       — branch from any checkpoint for A/B exploration
 *   - Replay        — re-run from any message ID
 */
export class TranscriptChain {
  private _messages: TranscriptMessage[] = [];
  readonly sessionId: string;

  constructor(sessionId: string, messages: TranscriptMessage[] = []) {
    this.sessionId = sessionId;
    this._messages = messages;
  }

  append(entry: TranscriptEntry): string {
    const id = nanoid();
    const lastId = this._messages.at(-1)?.id ?? null;
    this._messages.push({
      id,
      parentMessageId: lastId,
      role: entry.role,
      content: entry.content,
      createdAt: Date.now(),
      metadata: entry.metadata,
    });
    return id;
  }

  messages(): Readonly<TranscriptMessage[]> {
    return this._messages;
  }

  forkFrom(messageId: string, newSessionId: string): TranscriptChain {
    const idx = this._messages.findIndex(m => m.id === messageId);
    if (idx === -1) throw new Error(`Message ${messageId} not found in session ${this.sessionId}`);
    const snapshot = this._messages.slice(0, idx + 1).map(m => ({ ...m }));
    return new TranscriptChain(newSessionId, snapshot);
  }

  serialize(): string {
    return JSON.stringify({ sessionId: this.sessionId, messages: this._messages });
  }

  static deserialize(json: string): TranscriptChain {
    const { sessionId, messages } = JSON.parse(json);
    return new TranscriptChain(sessionId, messages);
  }
}
