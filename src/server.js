import http from 'node:http';
import { initialize } from './store.js';
import { createRuntime } from './runtime.js';

async function main() {
  const {pool,handler} = createRuntime();
  await initialize(pool);
  if ((process.env.AUTH_MODE || 'demo') === 'demo') console.warn('Evaluation mode: user_id is caller supplied. Use AUTH_MODE=token before public deployment.');
  const server = http.createServer(handler);
  server.listen(Number(process.env.PORT || 3000),process.env.HOST || '0.0.0.0', () => console.log('Task assistant server is listening'));
  const shutdown = () => {server.close(async () => {await pool.end();process.exit(0);});setTimeout(() => process.exit(1),10000).unref();};
  process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
}
main().catch(error => {console.error('Startup failed:',/^Set |^Provide |^AUTH_|^Remote/.test(error.message) ? error.message : error.name);process.exit(1);});
