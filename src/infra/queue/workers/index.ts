import { createSkillWorker } from '../bullmq';
import { skillRegistry } from '../../../modules/skills/skills.registry';
import type { SkillJobData, SkillJobResult } from '../bullmq';
import type { Job } from 'bullmq';

// Default skill worker processor — dispatches to skill registry
async function processSkillJob(job: Job<SkillJobData>): Promise<SkillJobResult> {
  const { skillId, args } = job.data;
  const result = await skillRegistry.invoke(skillId, args);
  if (result.ok) {
    return { success: true, value: result.value };
  }
  return { success: false, error: result.error.message };
}

export function startSkillWorkers(concurrency = 5) {
  return createSkillWorker(processSkillJob, { concurrency });
}
