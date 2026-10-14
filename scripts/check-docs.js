#!/usr/bin/env node
/**
 * check-docs.js — Documentation integrity checker
 * Verifies all local markdown links, required sections, and cross-references.
 * Run: node scripts/check-docs.js
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const DOCS = [
  'README.md',
  'POSTMAN_SETUP.md',
  'docs/deployment.md',
  'docs/decisions.md',
  'docs/capabilities.md',
  'docs/business-rules.md',
  'docs/workflows.md',
  'docs/assessment-report.md',
  'docs/telegram.md',
  'docs/integration-contract.md',
  'docs/03-decisions-ar.md',
  'docs/video-script-ar.md',
  'docs/video-walkthrough.md',
  'postman/README.md',
];

const REQUIRED_FILES = [
  'src/server.js', 'src/http.js', 'src/chat.js', 'src/store.js',
  'src/ai.js', 'src/language.js', 'src/runtime.js', 'src/responses.js',
  'src/telegram.js', 'src/workflows.js', 'src/reset.js',
  'scripts/demo.js', 'scripts/init-db.js', 'scripts/reset-db.js',
  'scripts/test-requests.sh', 'scripts/telegram-webhook.js',
  'test/server.test.js', 'test/workflows.test.js', 'test/telegram.test.js',
  'test/scenarios.js',
  'api/index.js',
  'package.json', '.env.example', 'Dockerfile', 'compose.yaml', 'vercel.json',
  '.github/workflows/test.yml',
];

const README_SECTIONS = [
  'API', 'Docker', 'AUTH_MODE', 'GEMINI_API_KEY', 'db:reset', 'npm test',
  'deployment.md', 'workflows.md', 'business-rules.md',
];

let problems = 0;

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  problems++;
}

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

// 1. Required source/config files exist
console.log('\n[1] Required project files');
for (const f of REQUIRED_FILES) {
  const full = join(root, f);
  if (existsSync(full)) ok(f);
  else fail(`Missing required file: ${f}`);
}

// 2. All doc files exist
console.log('\n[2] Documentation files');
for (const f of DOCS) {
  const full = join(root, f);
  if (existsSync(full)) ok(f);
  else fail(`Missing doc file: ${f}`);
}

// 3. Local markdown links resolve
console.log('\n[3] Markdown link integrity');
const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
for (const f of DOCS) {
  const full = join(root, f);
  if (!existsSync(full)) continue;
  const content = readFileSync(full, 'utf8');
  const dir = dirname(full);
  let match;
  linkRe.lastIndex = 0;
  while ((match = linkRe.exec(content)) !== null) {
    const href = match[2];
    if (href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto')) continue;
    const target = normalize(join(dir, href.split('#')[0]));
    if (existsSync(target)) ok(`${f} → ${href}`);
    else fail(`Broken link in ${f}: ${href}`);
  }
}

// 4. README contains required sections/keywords
console.log('\n[4] README required sections');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
for (const keyword of README_SECTIONS) {
  if (readme.includes(keyword)) ok(`README contains "${keyword}"`);
  else fail(`README missing section/keyword: "${keyword}"`);
}

// 5. .env.example has no hardcoded secrets
console.log('\n[5] .env.example security');
const envExample = readFileSync(join(root, '.env.example'), 'utf8');
const secretLines = envExample.split('\n')
  .filter(l => !l.startsWith('#'))
  .filter(l => /GEMINI_API_KEY|AUTH_TOKENS_JSON|TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET/.test(l))
  .filter(l => {
    const val = l.split('=').slice(1).join('=').trim();
    return val && val !== '{}' && val.length > 0 && !/^(false|true|0)$/.test(val);
  });
if (secretLines.length === 0) ok('.env.example contains no hardcoded secrets');
else secretLines.forEach(l => fail(`.env.example has potential secret: ${l.trim()}`));

// 6. package.json scripts completeness
console.log('\n[6] package.json scripts');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const required = ['start', 'test', 'demo', 'db:init', 'db:reset'];
for (const s of required) {
  if (pkg.scripts?.[s]) ok(`script "${s}" defined`);
  else fail(`Missing npm script: "${s}"`);
}
if (pkg.engines?.node) ok(`engines.node = "${pkg.engines.node}"`);
else fail('Missing engines.node in package.json');

// 7. Vercel config routes
console.log('\n[7] Vercel routing');
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const routes = (vercel.rewrites || []).map(r => r.source);
for (const path of ['/chat', '/health', '/telegram/webhook', '/telegram/link-code']) {
  if (routes.includes(path)) ok(`route "${path}" present`);
  else fail(`Missing Vercel rewrite for "${path}"`);
}

// 8. GitHub Actions workflow exists and references npm test
console.log('\n[8] CI/CD workflow');
const workflow = readFileSync(join(root, '.github/workflows/test.yml'), 'utf8');
if (workflow.includes('npm test')) ok('CI runs npm test');
else fail('CI workflow does not run npm test');
if (workflow.includes('node:22')) ok('CI uses Node.js 22');
else fail('CI does not specify Node.js 22');
if (workflow.includes('VERCEL_TOKEN')) ok('CI deploy step uses VERCEL_TOKEN secret');
else fail('CI deploy does not reference VERCEL_TOKEN');

// 9. Postman collections exist
console.log('\n[9] Postman collections');
const postmanFiles = [
  'postman/Task_Assistant_API.postman_collection.json',
  'postman/Test_Requests_T01-T10.postman_collection.json',
  'postman/Local_Environment.postman_environment.json',
  'postman/Production_Environment.postman_environment.json',
];
for (const f of postmanFiles) {
  if (existsSync(join(root, f))) ok(f);
  else fail(`Missing postman file: ${f}`);
}

// Final result
console.log('\n' + '─'.repeat(56));
if (problems === 0) {
  console.log('✅  No problems — documentation is complete and consistent.');
} else {
  console.log(`❌  ${problems} problem(s) found. Fix the issues listed above.`);
  process.exit(1);
}
