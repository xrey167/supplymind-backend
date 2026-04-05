import { nanoid } from 'nanoid';
import { logger } from '../../config/logger';

export interface ComputerUseSession {
  id: string;
  workspaceId: string;
  viewportWidth: number;
  viewportHeight: number;
  browser: import('playwright').Browser;
  page: import('playwright').Page;
  bashProcess?: import('child_process').ChildProcessWithoutNullStreams;
  createdAt: Date;
}

class ComputerUseSessionManager {
  private sessions = new Map<string, ComputerUseSession>();

  async create(workspaceId: string, opts: { viewportWidth?: number; viewportHeight?: number } = {}): Promise<ComputerUseSession> {
    const { chromium } = await import('playwright');
    const width = opts.viewportWidth ?? 1280;
    const height = opts.viewportHeight ?? 800;

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width, height });

    const session: ComputerUseSession = {
      id: nanoid(),
      workspaceId,
      viewportWidth: width,
      viewportHeight: height,
      browser,
      page,
      createdAt: new Date(),
    };

    this.sessions.set(session.id, session);
    logger.info({ sessionId: session.id, workspaceId, width, height }, 'Computer use session created');
    return session;
  }

  get(id: string): ComputerUseSession | undefined {
    return this.sessions.get(id);
  }

  async destroy(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;

    if (session.bashProcess) {
      session.bashProcess.kill();
    }
    try {
      await session.browser.close();
    } catch (err) {
      logger.warn({ sessionId: id, error: err instanceof Error ? err.message : String(err) }, 'Error closing browser');
    }
    this.sessions.delete(id);
    logger.info({ sessionId: id }, 'Computer use session destroyed');
  }

  /** Destroy all sessions — called on server shutdown */
  async destroyAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    await Promise.allSettled(ids.map(id => this.destroy(id)));
  }

  listForWorkspace(workspaceId: string): Pick<ComputerUseSession, 'id' | 'workspaceId' | 'viewportWidth' | 'viewportHeight' | 'createdAt'>[] {
    return Array.from(this.sessions.values())
      .filter(s => s.workspaceId === workspaceId)
      .map(({ id, workspaceId, viewportWidth, viewportHeight, createdAt }) => ({
        id, workspaceId, viewportWidth, viewportHeight, createdAt,
      }));
  }
}

export const sessionManager = new ComputerUseSessionManager();
