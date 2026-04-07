import { logger } from '../../../config/logger';
import { pluginInstallationRepo } from '../../../modules/plugins/plugins.repo';
import { pluginsService } from '../../../modules/plugins/plugins.service';
import { getMetrics } from '../../observability/metrics';

export async function processHealthCheckJob(): Promise<void> {
  const installations = await pluginInstallationRepo.listEnabled();
  const appMetrics = getMetrics();

  await Promise.allSettled(
    installations.map(async (inst) => {
      try {
        const result = await pluginsService.runHealthCheck(inst.id);
        const healthy = result.ok ? 1 : 0;
        appMetrics.pluginHealthGauge.addCallback((obs) => {
          obs.observe(healthy, {
            pluginId: inst.pluginId,
            workspaceId: inst.workspaceId,
          });
        });
        logger.debug({ instId: inst.id, healthy }, 'plugin health check');
      } catch (err) {
        logger.warn({ instId: inst.id, err }, 'plugin health check failed');
      }
    }),
  );
}
