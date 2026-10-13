import pg from 'pg';
import { databaseConfig } from '../src/runtime.js';
import { initialize } from '../src/store.js';
const pool = new pg.Pool(databaseConfig());
try {
  await initialize(pool);
  console.log('Database initialized and employees seeded.');
} catch (error) {
  console.error('Database initialization failed:',error.name);process.exitCode=1;
} finally {await pool.end();}
