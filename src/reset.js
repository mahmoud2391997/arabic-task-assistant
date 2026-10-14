import { initialize } from './store.js';

// Hosts that count as "local": a developer machine or the Docker Compose `db` service.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'db']);

export function isLocalDatabase(databaseUrl) {
  try { return LOCAL_HOSTS.has(new URL(databaseUrl).hostname); }
  catch { return false; }
}

// Every application table. TRUNCATE ... CASCADE also clears anything that references them.
export const resettableTables = [
  'telegram_updates', 'telegram_sessions', 'telegram_access', 'telegram_conversations',
  'telegram_link_codes', 'telegram_bindings', 'employee_requests', 'task_notifications',
  'audit_log', 'tasks', 'employees',
];

// Empties all data, restarts the ID counters (so tasks start again at #1) and re-seeds
// the six fictional employees. Callers must check isLocalDatabase() first.
export async function resetDatabase(pool) {
  await initialize(pool); // make sure every table exists before truncating
  await pool.query(`TRUNCATE ${resettableTables.join(', ')} RESTART IDENTITY CASCADE`);
  await initialize(pool); // seed employees again
}
