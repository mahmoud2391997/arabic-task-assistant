import pg from 'pg';
import { readFileSync } from 'node:fs';
import { attachDatabasePool } from '@vercel/functions';
import { Store } from './store.js';
import { createAI } from './ai.js';
import { createChat } from './chat.js';
import { createHandler } from './http.js';

export function databaseConfig(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('Set DATABASE_URL');
  const url = new URL(env.DATABASE_URL);
  const sslEnabled = env.DATABASE_SSL === 'true';
  if (sslEnabled) url.searchParams.delete('sslmode');
  return {
    connectionString:url.toString(),
    ...(sslEnabled ? {ssl:{rejectUnauthorized:true,
      ...(env.DATABASE_CA_FILE ? {ca:readFileSync(env.DATABASE_CA_FILE,'utf8')} : {})}} : {}),
    max:env.VERCEL ? 3 : 10,
    connectionTimeoutMillis:10000, query_timeout:10000, idleTimeoutMillis:10000,
  };
}

export function createRuntime(env = process.env) {
  if (env.VERCEL && env.AUTH_MODE !== 'token') throw new Error('Set AUTH_MODE=token for Vercel deployment');
  const ai = createAI({baseURL:env.AI_BASE_URL || 'https://api.groq.com/openai/v1',
    apiKey:env.GROQ_API_KEY || env.AI_API_KEY, model:env.AI_MODEL || 'qwen/qwen3.8-27b'});
  const pool = new pg.Pool(databaseConfig(env));
  if (env.VERCEL) attachDatabasePool(pool);
  pool.on('error', () => console.error('Idle database connection failed'));
  try {
    const handler = createHandler({chat:createChat({store:new Store(pool),ai}),
      authMode:env.AUTH_MODE || 'demo', tokens:JSON.parse(env.AUTH_TOKENS_JSON || '{}'),
      health:() => pool.query('SELECT 1 FROM employees LIMIT 1')});
    return {pool,handler};
  } catch (error) { void pool.end(); throw error; }
}
