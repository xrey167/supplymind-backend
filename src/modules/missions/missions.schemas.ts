import { z } from 'zod';

const MISSION_MODES = ['assist', 'interview', 'advisor', 'team', 'autopilot', 'discipline'] as const;
const ARTIFACT_KINDS = ['text', 'json', 'file', 'image', 'code', 'report'] as const;

export const createMissionSchema = z.object({
  name: z.string().min(1).max(255),
  mode: z.enum(MISSION_MODES),
  input: z.record(z.string(), z.unknown()).optional().default({}),
  disciplineMaxRetries: z.number().int().min(1).max(10).optional().default(3),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const missionIdParamSchema = z.object({
  missionId: z.string().uuid(),
});

export const listMissionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});

export const createArtifactSchema = z.object({
  kind: z.enum(ARTIFACT_KINDS),
  title: z.string().optional(),
  content: z.string().optional(),
  contentJson: z.record(z.string(), z.unknown()).optional(),
  workerId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
