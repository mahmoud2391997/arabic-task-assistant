# GitHub → Vercel → Neon

Upload source to a private GitHub repository. `.env`, `.vercel`, node_modules and temporary assets are excluded. Only `.env.example` is committed. Import the repository into Vercel as an Other framework, with Node.js 22; `api/index.js` is the shared Node.js function. `/chat` and `/health` rewrite to it. The standalone `npm start` server remains available for local development.

Create a Neon PostgreSQL project and use its pooled connection string (`-pooler` hostname) for serverless deployment. Configure these Vercel environment variables for production and preview as appropriate:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Neon pooled PostgreSQL URL |
| `DATABASE_SSL` | `true` |
| `GROQ_API_KEY` | Your existing Groq key |
| `AI_BASE_URL` | `https://api.groq.com/openai/v1` |
| `AI_MODEL` | `qwen/qwen3.8-27b` |
| `AUTH_MODE` | `token` |
| `AUTH_TOKENS_JSON` | JSON mapping employee IDs to distinct random tokens of at least 32 characters |

Generate each token with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep mappings in a local ignored environment file and Vercel secrets; do not paste secrets into the repository, logs, screenshots or documentation. Public deployments require token authentication so callers cannot impersonate an employee by changing `user_id`.

Use a separate ignored local `.env.production.local` containing the Neon connection, `DATABASE_SSL=true` and deployment tokens. Initialize Neon once with:

```bash
node --env-file=.env.production.local scripts/init-db.js
```

This creates tables and seeds the six fictional employees; it does not copy local tasks. Schema setup runs outside request handling to avoid DDL on every serverless cold start. Redeploy after adding/changing Vercel environment variables. Verify `/health`, then send a `/chat` request with `Authorization: Bearer <employee-token>` and a matching user_id.

For the ten-message live demo, provide all six tokens in `.env.production.local` and run:

```bash
SERVER_URL=https://your-project.vercel.app node --env-file=.env.production.local scripts/demo.js
```

Vercel deployment protection may require a separate authorized testing workflow; do not disable it blindly. The demo creates three evaluation tasks. Automated destructive database tests remain restricted to a disposable `TEST_DATABASE_URL`; never run those against the Neon production database.

References: [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js), [Neon connection pooling](https://neon.com/docs/connect/connection-pooling).

## Verified deployed environment

On October 13, 2026, the production deployment at https://arabic-task-assistant-iti1.vercel.app passed all ten live scenarios against Groq and the newly provisioned Neon free-plan database. The runtime uses token authentication and verified PostgreSQL TLS. The existing Vercel protection setting also requires a Vercel login for requests to the generated domain.

For authenticated testing without exposing token values:

```bash
SERVER_URL=https://arabic-task-assistant-iti1.vercel.app VERCEL_CLI_PATH=.tools/vercel-runtime/node_modules/.bin/vercel node --env-file=.env.production.local scripts/demo-protected.js
```

This invokes authenticated `vercel curl` requests and reads employee tokens from the ignored production file. Results are saved to the ignored `.tools/cloud-demo-results.json`. Normal unprotected curl cannot bypass Vercel platform protection; changing that protection requires a deliberate access decision.

Source is pushed to the private GitHub repository. The successful production deployment used the Vercel CLI; automatic GitHub-to-Vercel deployment is not linked because the Vercel GitHub connection rejected access to the private repository. Until that account connection is authorized, deploy updates from this linked checkout with the authenticated CLI.
