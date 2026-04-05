import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { ok, err } from '../../core/result';
import { AppError } from '../../core/errors';
import { logger } from '../../config/logger';
import { sessionManager } from './computer-use.session';
import type { ToolDefinition } from '../../infra/ai/types';
import type { ImageContentBlock } from '../../infra/ai/types';

// ── Constants ────────────────────────────────────────────────────────────────

export const COMPUTER_TOOL_VERSION = 'computer_20251124' as const;
export const BASH_TOOL_VERSION = 'bash_20250124' as const;
export const TEXT_EDITOR_TOOL_VERSION = 'text_editor_20250728' as const;
export const COMPUTER_USE_BETA = 'computer-use-2025-11-24' as const;
export const TEXT_EDITOR_NAME = 'str_replace_based_edit_tool' as const;
export const INTER_ACTION_DELAY_MS = 120;

// ── Tool ToolDefinition factories ────────────────────────────────────────────

export function buildComputerToolDef(sessionId: string, width = 1280, height = 800): ToolDefinition {
  return {
    name: 'computer',
    description: `Control the browser: take screenshots, click, type, scroll. Session: ${sessionId}`,
    inputSchema: {},
    betaType: COMPUTER_TOOL_VERSION,
    displayWidth: width,
    displayHeight: height,
  };
}

export function buildBashToolDef(sessionId: string): ToolDefinition {
  return {
    name: 'bash',
    description: `Run shell commands in a persistent bash session. Session: ${sessionId}`,
    inputSchema: {},
    betaType: BASH_TOOL_VERSION,
  };
}

export function buildTextEditorToolDef(sessionId: string): ToolDefinition {
  return {
    name: TEXT_EDITOR_NAME,
    description: `View and edit files. Session: ${sessionId}`,
    inputSchema: {},
    betaType: TEXT_EDITOR_TOOL_VERSION,
  };
}

// ── Computer tool handler ─────────────────────────────────────────────────────

export async function handleComputerAction(sessionId: string, args: unknown) {
  const session = sessionManager.get(sessionId);
  if (!session) return err(new AppError('Computer use session not found', 404, 'NOT_FOUND'));

  const { page } = session;
  const input = args as Record<string, unknown>;
  const action = input.action as string;

  try {
    await new Promise(res => setTimeout(res, INTER_ACTION_DELAY_MS));

    switch (action) {
      case 'screenshot': {
        const buf = await page.screenshot({ type: 'png' });
        const data = buf.toString('base64');
        const result: ImageContentBlock[] = [{
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data },
        }];
        return ok(result);
      }

      case 'left_click': {
        const [x, y] = input.coordinate as [number, number];
        await page.mouse.click(x, y, { button: 'left' });
        return ok('Left click performed');
      }

      case 'right_click': {
        const [x, y] = input.coordinate as [number, number];
        await page.mouse.click(x, y, { button: 'right' });
        return ok('Right click performed');
      }

      case 'middle_click': {
        const [x, y] = input.coordinate as [number, number];
        await page.mouse.click(x, y, { button: 'middle' });
        return ok('Middle click performed');
      }

      case 'double_click': {
        const [x, y] = input.coordinate as [number, number];
        await page.mouse.dblclick(x, y);
        return ok('Double click performed');
      }

      case 'mouse_move': {
        const [x, y] = input.coordinate as [number, number];
        await page.mouse.move(x, y);
        return ok('Mouse moved');
      }

      case 'left_click_drag': {
        const [startX, startY] = input.start_coordinate as [number, number];
        const [endX, endY] = input.coordinate as [number, number];
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(endX, endY);
        await page.mouse.up();
        return ok('Drag performed');
      }

      case 'type': {
        await page.keyboard.type(input.text as string);
        return ok('Text typed');
      }

      case 'key': {
        // Map Anthropic key format (ctrl+c) to Playwright (Control+C)
        const keyStr = (input.text as string)
          .replace(/\bctrl\b/gi, 'Control')
          .replace(/\balt\b/gi, 'Alt')
          .replace(/\bshift\b/gi, 'Shift')
          .replace(/\bmeta\b/gi, 'Meta')
          .replace(/\bsuper\b/gi, 'Meta')
          .replace(/\+/g, '+');
        await page.keyboard.press(keyStr);
        return ok(`Key pressed: ${keyStr}`);
      }

      case 'scroll': {
        const [x, y] = input.coordinate as [number, number];
        const direction = input.direction as 'up' | 'down';
        const amount = (input.amount as number) ?? 3;
        await page.mouse.move(x, y);
        const delta = direction === 'down' ? amount * 100 : -(amount * 100);
        await page.mouse.wheel(0, delta);
        return ok('Scrolled');
      }

      case 'cursor_position': {
        // Return current viewport dimensions as proxy
        return ok(`Viewport: ${session.viewportWidth}x${session.viewportHeight}`);
      }

      default:
        return err(new AppError(`Unknown computer action: ${action}`, 400, 'INVALID_INPUT'));
    }
  } catch (error) {
    logger.warn({ sessionId, action, error: error instanceof Error ? error.message : String(error) }, 'Computer action failed');
    return err(error instanceof Error ? error : new AppError(String(error), 500, 'INTERNAL_ERROR'));
  }
}

// ── Bash tool handler ─────────────────────────────────────────────────────────

const BASH_SENTINEL = '<<BASH_EXIT_SENTINEL>>';
const BASH_TIMEOUT_MS = 30_000;

export async function handleBashAction(sessionId: string, args: unknown) {
  const session = sessionManager.get(sessionId);
  if (!session) return err(new AppError('Computer use session not found', 404, 'NOT_FOUND'));

  const input = args as Record<string, unknown>;
  const command = input.command as string | undefined;
  const restart = input.restart as boolean | undefined;

  try {
    if (restart && session.bashProcess) {
      session.bashProcess.kill();
      session.bashProcess = undefined;
    }

    if (!session.bashProcess) {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'cmd.exe' : '/bin/bash';
      const proc = spawn(shell, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME ?? '/tmp',
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          TERM: 'dumb',
          LANG: process.env.LANG,
        },
      });
      session.bashProcess = proc as any;
    }

    if (!command) return ok('Bash session ready');

    const proc = session.bashProcess!;
    const output = await new Promise<string>((resolve, reject) => {
      const chunks: string[] = [];
      const timeout = setTimeout(() => {
        proc.stdout.off('data', onData);
        proc.stderr.off('data', onData);
        reject(new Error(`Bash command timed out after ${BASH_TIMEOUT_MS}ms`));
      }, BASH_TIMEOUT_MS);

      const onData = (data: Buffer) => {
        chunks.push(data.toString());
        const full = chunks.join('');
        const sentinelIdx = full.indexOf(BASH_SENTINEL);
        if (sentinelIdx !== -1) {
          clearTimeout(timeout);
          proc.stdout.off('data', onData);
          proc.stderr.off('data', onData);
          resolve(full.slice(0, sentinelIdx).trimEnd());
        }
      };

      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.stdin.write(`${command}\necho "${BASH_SENTINEL}"\n`);
    });

    return ok(output);
  } catch (error) {
    // Kill stale process on error
    if (session.bashProcess) {
      session.bashProcess.kill();
      session.bashProcess = undefined;
    }
    logger.warn({ sessionId, error: error instanceof Error ? error.message : String(error) }, 'Bash action failed');
    return err(error instanceof Error ? error : new AppError(String(error), 500, 'INTERNAL_ERROR'));
  }
}

// ── Text editor tool handler ──────────────────────────────────────────────────

export async function handleTextEditorAction(sessionId: string, args: unknown) {
  // Validate session exists
  const session = sessionManager.get(sessionId);
  if (!session) return err(new AppError('Computer use session not found', 404, 'NOT_FOUND'));

  const input = args as Record<string, unknown>;
  const command = input.command as string;
  const filePath = input.path as string | undefined;

  try {
    if (filePath && !path.isAbsolute(filePath)) {
      return err(new AppError(`Path must be absolute: ${filePath}`, 400, 'INVALID_INPUT'));
    }

    const sandboxBase = path.join(tmpdir(), 'cu-sessions', sessionId);
    if (filePath && !filePath.startsWith(sandboxBase)) {
      return err(new AppError(`File operations are restricted to the session sandbox: ${sandboxBase}`, 403, 'FORBIDDEN'));
    }

    switch (command) {
      case 'view': {
        const content = await fs.readFile(filePath!, 'utf-8');
        return ok(content);
      }

      case 'create': {
        const fileText = input.file_text as string;
        await fs.mkdir(path.dirname(filePath!), { recursive: true });
        await fs.writeFile(filePath!, fileText, 'utf-8');
        return ok(`File created: ${filePath}`);
      }

      case 'str_replace': {
        const oldStr = input.old_str as string;
        const newStr = input.new_str as string;
        const content = await fs.readFile(filePath!, 'utf-8');
        const count = content.split(oldStr).length - 1;
        if (count === 0) return err(new AppError(`old_str not found in file: ${filePath}`, 400, 'INVALID_INPUT'));
        if (count > 1) return err(new AppError(`old_str matches ${count} times — must match exactly once: ${filePath}`, 400, 'INVALID_INPUT'));
        await fs.writeFile(filePath!, content.replace(oldStr, newStr), 'utf-8');
        return ok(`File updated: ${filePath}`);
      }

      case 'insert': {
        const insertLine = input.insert_line as number;
        const newStr = input.new_str as string;
        const content = await fs.readFile(filePath!, 'utf-8');
        const lines = content.split('\n');
        lines.splice(insertLine, 0, newStr);
        await fs.writeFile(filePath!, lines.join('\n'), 'utf-8');
        return ok(`Inserted at line ${insertLine}: ${filePath}`);
      }

      case 'undo_edit': {
        return err(new AppError('undo_edit is not supported in this implementation', 400, 'NOT_SUPPORTED'));
      }

      default:
        return err(new AppError(`Unknown text editor command: ${command}`, 400, 'INVALID_INPUT'));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return err(new AppError(`File not found: ${filePath}`, 404, 'NOT_FOUND'));
    }
    logger.warn({ sessionId, command, filePath, error: error instanceof Error ? error.message : String(error) }, 'Text editor action failed');
    return err(error instanceof Error ? error : new AppError(String(error), 500, 'INTERNAL_ERROR'));
  }
}
