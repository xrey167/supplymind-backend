import type { MiddlewareHandler } from 'hono';
import { scanMessages } from '../../infra/security/prompt-injection.guard';
import { logger } from '../../config/logger';

export type InjectionGuardMode = 'block' | 'warn' | 'log';

export interface InjectionGuardOptions {
  mode?: InjectionGuardMode;
  enabled?: boolean;
}

export function promptInjectionMiddleware(
  options: InjectionGuardOptions = {},
): MiddlewareHandler {
  const mode: InjectionGuardMode =
    (options.mode ?? (Bun.env.INJECTION_GUARD_MODE as InjectionGuardMode)) ?? 'warn';
  const enabled = options.enabled ?? Bun.env.INJECTION_GUARD_ENABLED !== 'false';

  return async (c, next) => {
    if (!enabled || !['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
      return next();
    }

    try {
      const body = await c.req.json().catch(() => null);
      if (!body || !Array.isArray(body.messages)) return next();

      const result = scanMessages(body.messages);

      if (result.flagged) {
        if (mode === 'block' && result.shouldBlock) {
          logger.warn({ detections: result.detections }, '[InjectionGuard] Request blocked');
          return c.json(
            {
              error: {
                code: 'INJECTION_BLOCKED',
                message: 'Request blocked: potential prompt injection detected',
                detections: result.detections.length,
              },
            },
            400,
          );
        }
        logger.warn(
          { detections: result.detections },
          '[InjectionGuard] Injection patterns detected (not blocked)',
        );
      }
    } catch {
      // Fail open — never break a request due to guard errors
    }

    return next();
  };
}
