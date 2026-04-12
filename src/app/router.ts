import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../core/types';

export const router = new OpenAPIHono<AppEnv>();
