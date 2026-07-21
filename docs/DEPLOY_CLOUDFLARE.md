# Deploy to Cloudflare (Workers + D1)

The edge profile: the API runs on Cloudflare Workers, data lives in D1.
Same code as the self-hosted Bun profile; only the connector binding differs.
Auth (better-auth) uses the same D1 database; its tables are created on
first request alongside the content schema.

## Prerequisites

- A Cloudflare account (free tier is enough)
- `bun install` done at the repo root

## 1. Authenticate wrangler

```bash
cd apps/worker
bunx wrangler login
```

## 2. Create the D1 database

```bash
bunx wrangler d1 create opencms
```

Copy the `database_id` from the output into `apps/worker/wrangler.toml`.

The schema needs no migration step: the Worker creates the fixed content
tables and the auth tables on first request (both inits are idempotent),
and content types never require DDL afterwards. Field indexes are created
at runtime by `ensureIndexes`.

## 3. Set the auth secret

```bash
openssl rand -base64 32 | bunx wrangler secret put BETTER_AUTH_SECRET
```

Optionally set the canonical URL (used for cookies and origin checks) in
`wrangler.toml` once you know it:

```toml
[vars]
BETTER_AUTH_URL = "https://opencms-api.<account>.workers.dev"
```

## 4. Build the admin and deploy

The Worker ships the admin SPA as static assets, so build it first:

```bash
bun run --cwd ../admin build
bunx wrangler deploy
```

Wrangler prints your URL, e.g. `https://opencms-api.<account>.workers.dev`.
The admin UI is served at that URL's root; `/api/*` and `/health` hit the
Worker directly (`run_worker_first`).

## 5. Bootstrap the admin and smoke test

Open the deployed URL: the admin UI shows the first-run setup screen and
creates the admin account there. Or bootstrap over HTTP:

```bash
API=https://opencms-api.<account>.workers.dev

curl $API/health

# 1. Bootstrap: the first user is the admin
curl -X POST $API/api/auth/sign-up/email \
  -H 'content-type: application/json' \
  -c cookies.txt \
  -d '{"email":"you@example.com","password":"a-strong-password","name":"You"}'

# 2. Create the schema (admin session)
curl -X POST $API/api/content-types \
  -H 'content-type: application/json' \
  -b cookies.txt \
  -d '{"name":"article","label":"Article","fields":[{"name":"title","kind":"text","required":true},{"name":"views","kind":"number","indexed":true}]}'

# 3. Mint an API key for machines (admin session; Origin header required
#    on auth endpoints when authenticating with cookies outside a browser)
curl -X POST $API/api/auth/api-key/create \
  -H 'content-type: application/json' \
  -H "Origin: $API" \
  -b cookies.txt \
  -d '{"name":"ci","metadata":{"role":"editor"}}'

# 4. Write content with the key
curl -X POST $API/api/content/article \
  -H 'content-type: application/json' \
  -H 'x-api-key: <key from step 3>' \
  -d '{"status":"published","data":{"title":"Hello from the edge"}}'

# 5. Published content is readable without auth
curl "$API/api/content/article?sort=createdAt:desc"
```

## Local development against workerd

```bash
cd apps/worker
echo 'BETTER_AUTH_SECRET=local-dev-secret-never-deploy-0123456789' > .dev.vars
bunx wrangler dev
```

`wrangler dev` runs the Worker in workerd with a local D1. Note that the
test suite already exercises real workerd D1 via Miniflare
(`packages/connector-d1/test/conformance.test.ts`), so `bun test` at the
repo root is the primary verification loop; `wrangler dev` is for manual
poking.

## Access model (since M3)

- Anonymous requests can read published entries only.
- Editors (sessions or API keys with the editor role) manage content.
- Admins additionally manage content types, users and API keys.
- User accounts are created by admins (`POST /api/auth/admin/create-user`);
  public signup only ever works for the very first user.

## Caveats (current milestone)

- One Worker, one D1 database. Multi-tenant setups deploy one Worker per
  site for now.
- Media (R2) arrives in M5.
