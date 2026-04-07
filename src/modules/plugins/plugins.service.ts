import { pluginInstallationRepo } from './plugins.repo';
import { logger } from '../../config/logger';

export interface HealthCheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export const pluginsService = {
  /**
   * Run a basic health check for a plugin installation.
   * Verifies the installation exists and is enabled in the DB.
   * For plugins with custom health check logic, this can be extended
   * to call plugin-specific endpoints.
   */
  async runHealthCheck(installationId: string): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const installation = await pluginInstallationRepo.findById(installationId);
      const latencyMs = Date.now() - start;

      if (!installation || !installation.enabled) {
        return { ok: false, latencyMs, error: 'Installation not found or disabled' };
      }

      return { ok: true, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - start;
      logger.warn({ installationId, err }, 'plugin health check failed');
      return { ok: false, latencyMs, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
