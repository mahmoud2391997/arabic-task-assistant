import test from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { initialize } from '../src/store.js';
import { isLocalDatabase, resettableTables } from '../src/reset.js';

test('reset refuses anything that is not a local or Compose database', () => {
  for (const url of [
    'postgres://assistant:assistant@localhost:5433/assistant',
    'postgres://assistant:assistant@127.0.0.1:5433/assistant',
    'postgres://assistant:assistant@db:5432/assistant',
    'postgres://assistant:assistant@[::1]:5433/assistant',
  ]) assert.equal(isLocalDatabase(url), true, url);
  for (const url of [
    'postgres://u:p@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require',
    'postgres://u:p@localhost.evil.example/db',
    'not a url', '', undefined,
  ]) assert.equal(isLocalDatabase(url), false, String(url));
});

test('resettableTables lists every table created by initialize()', async () => {
  const pool = new (newDb().adapters.createPg().Pool)();
  await initialize(pool);
  const rows = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows;
  assert.deepEqual(rows.map(r => r.table_name).sort(), [...resettableTables].sort(),
    'add new tables to resettableTables in src/reset.js');
  await pool.end();
});
