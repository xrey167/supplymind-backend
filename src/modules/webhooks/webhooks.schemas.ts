import { z } from 'zod';

export const CreateEndpointBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const EndpointParamsSchema = z.object({
  endpointId: z.string().uuid(),
});

export const IngestParamsSchema = z.object({
  token: z.string().min(1),
});
