import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { auditLogs } from './src/infra/db/schema/index';

const client = postgres('postgresql://supplymind:supplymind@127.0.0.1:5433/supplymind_test', { max: 1 });
const db = drizzle(client);

const query = db.insert(auditLogs).values({
  workspaceId: '00000000-0000-0000-0000-000000000001',
  actorId: 'user_test',
  actorType: 'user',
  action: 'create',
  resourceType: 'agent',
  resourceId: 'agent-1',
  metadata: {},
}).toSQL();

console.log('SQL:', query.sql);
console.log('Params:', JSON.stringify(query.params));

process.exit(0);
