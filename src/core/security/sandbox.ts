import { ok, err } from '../result';
import type { Result } from '../result';
import { logger } from '../../config/logger';
import type { SandboxPolicy } from '../../modules/settings/workspace-settings/workspace-settings.schemas';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

export interface SandboxRunInput {
  code: string;
  args: unknown;
  policy: SandboxPolicy;
  toolId?: string;
  toolName?: string;
}

export interface SandboxRunResult {
  value: unknown;
  durationMs: number;
}

function buildRunnerScript(policy: SandboxPolicy): string {
  const networkGuard = !policy.allowNetwork ? `
// Block network access
const blocked = () => { throw new Error('Network access is disabled by sandbox policy'); };
globalThis.fetch = blocked;
globalThis.XMLHttpRequest = blocked;
globalThis.WebSocket = blocked;
` : '';

  const allowedPaths = JSON.stringify(policy.allowedPaths ?? []);
  const deniedPaths = JSON.stringify(policy.deniedPaths ?? []);
  const fsGuard = `
// Filesystem access control
const __allowedPaths = ${allowedPaths};
const __deniedPaths = ${deniedPaths};
const __path = require('path');

function __checkPath(p) {
  const resolved = __path.resolve(p);
  for (const denied of __deniedPaths) {
    if (resolved.startsWith(denied)) throw new Error('Access denied: path blocked by sandbox policy: ' + p);
  }
  if (__allowedPaths.length > 0) {
    const allowed = __allowedPaths.some(a => resolved.startsWith(a));
    if (!allowed) throw new Error('Access denied: path not in sandbox allowlist: ' + p);
  }
}

// Wrap Bun.file to enforce path restrictions
const __origBunFile = Bun.file.bind(Bun);
Bun.file = (p, ...rest) => { __checkPath(String(p)); return __origBunFile(p, ...rest); };

// Wrap Bun.write to enforce path restrictions
const __origBunWrite = Bun.write.bind(Bun);
Bun.write = (p, ...rest) => {
  if (typeof p === 'string') __checkPath(p);
  return __origBunWrite(p, ...rest);
};
`;

  return `
${networkGuard}
${fsGuard}
const payload = JSON.parse(process.env.__SANDBOX_PAYLOAD);
try {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const fn = new AsyncFunction('args', payload.code);
  const result = await fn(payload.args);
  process.stdout.write(JSON.stringify({ value: result ?? null }) + '\\n');
} catch (e) {
  process.stdout.write(JSON.stringify({ error: e.message ?? String(e) }) + '\\n');
}
`;
}

/**
 * Execute admin-defined inline tool code in an isolated Bun subprocess.
 *
 * SECURITY CONTEXT: Inline tools are created exclusively by workspace admins
 * through the tool CRUD API (requires admin role via RBAC). This sandbox adds
 * defense-in-depth by isolating execution in a separate process, preventing
 * access to the parent process's memory, secrets, and database connections.
 *
 * Isolation guarantees:
 * - Separate V8 isolate (no access to parent memory/globals)
 * - Timeout enforcement via AbortController
 * - Stripped environment (no DB credentials, API keys, etc.)
 * - Configurable per-workspace via SandboxPolicy
 */
export async function runInSandbox(input: SandboxRunInput): Promise<Result<SandboxRunResult>> {
  const { code, args, policy, toolId, toolName } = input;
  const startTime = performance.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), policy.maxTimeoutMs);

  // Write runner script to a temp file so Bun can execute it directly
  const scriptPath = join(tmpdir(), `sandbox-${randomUUID()}.js`);

  try {
    const payload = JSON.stringify({ code, args });

    // nosec: intentional dynamic code execution in isolated subprocess
    // Inline tools are admin-defined (RBAC-gated). The subprocess runs with
    // a stripped environment — no DB credentials, API keys, or parent memory access.
    const scriptContent = buildRunnerScript(policy);
    await Bun.write(scriptPath, scriptContent);

    const proc = Bun.spawn({
      cmd: ['bun', 'run', scriptPath],
      stdout: 'pipe',
      stderr: 'pipe',
      signal: controller.signal,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        TMPDIR: process.env.TMPDIR ?? '',
        SANDBOX: '1',
        SANDBOX_ALLOW_NETWORK: policy.allowNetwork ? '1' : '0',
        SANDBOX_MAX_MEMORY_MB: String(policy.maxMemoryMb),
        __SANDBOX_PAYLOAD: payload,
      },
    });

    const exitCode = await proc.exited;
    const stdoutText = await new Response(proc.stdout).text();
    const stderrText = await new Response(proc.stderr).text();

    const durationMs = Math.round(performance.now() - startTime);

    // Exit code 143 = killed by SIGTERM (from AbortController timeout)
    if (exitCode === 143 || (exitCode !== 0 && controller.signal.aborted)) {
      logger.warn({ toolId, toolName, timeoutMs: policy.maxTimeoutMs, durationMs }, 'Sandbox execution timed out');
      return err(new Error(`Sandbox timeout: execution exceeded ${policy.maxTimeoutMs}ms`));
    }

    if (exitCode !== 0) {
      const errorMsg = stderrText.trim() || `Sandbox process exited with code ${exitCode}`;
      logger.warn({ toolId, toolName, exitCode, durationMs, stderr: stderrText.slice(0, 500) }, 'Sandbox execution failed');
      return err(new Error(`Sandbox error: ${errorMsg.slice(0, 1000)}`));
    }

    const lines = stdoutText.trim().split('\n');
    const lastLine = lines[lines.length - 1];

    if (!lastLine) {
      return err(new Error('Sandbox produced no output'));
    }

    try {
      const result = JSON.parse(lastLine);
      if (result.error) {
        return err(new Error(`Sandbox runtime error: ${result.error}`));
      }
      return ok({ value: result.value, durationMs });
    } catch {
      return err(new Error(`Sandbox output not valid JSON: ${lastLine.slice(0, 200)}`));
    }
  } catch (error) {
    const durationMs = Math.round(performance.now() - startTime);
    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn({ toolId, toolName, timeoutMs: policy.maxTimeoutMs, durationMs }, 'Sandbox execution timed out');
      return err(new Error(`Sandbox timeout: execution exceeded ${policy.maxTimeoutMs}ms`));
    }
    return err(error instanceof Error ? error : new Error(String(error)));
  } finally {
    clearTimeout(timeout);
    // Clean up temp file
    try {
      await import('fs/promises').then(fs => fs.unlink(scriptPath));
    } catch (cleanupErr) {
      logger.debug({ scriptPath, error: cleanupErr }, 'Failed to clean up sandbox temp file');
    }
  }
}
