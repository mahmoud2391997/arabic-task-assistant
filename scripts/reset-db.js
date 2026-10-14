import pg from 'pg';
import { databaseConfig } from '../src/runtime.js';
import { isLocalDatabase, resetDatabase } from '../src/reset.js';

// Wipes demo data so the ten test messages start from a clean slate.
// Refuses to run against anything that is not a local or Docker Compose database.
if (!isLocalDatabase(process.env.DATABASE_URL ?? '')) {
  console.error('Refusing to reset: DATABASE_URL must point to localhost, 127.0.0.1 or the Compose "db" service.');
  process.exit(1);
}
const pool = new pg.Pool(databaseConfig());
try {
  await resetDatabase(pool);
  console.log('Database reset: all tasks, requests, audit entries and Telegram data cleared; IDs restart at 1; six employees re-seeded.');
} catch (error) {
  console.error('Database reset failed:', error.name, error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
