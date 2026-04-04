import { serve } from 'bun';
import { createApp } from './app/create-app';

const app = createApp();
const port = Number(process.env.PORT) || 3001;

serve({ fetch: app.fetch, port });
console.log(`Server running on port ${port}`);
