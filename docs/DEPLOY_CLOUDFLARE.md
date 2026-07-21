# Deploy to Cloudflare (Workers + D1)

The edge profile: the API runs on Cloudflare Workers, data lives in D1.
Same code as the self-hosted Bun profile; only the connector binding differs.

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

The schema needs no migration step: the Worker creates the two fixed tables
on first request (`init()` is idempotent), and content types never require
DDL afterwards. Field indexes are created at runtime by `ensureIndexes`.

## 3. Deploy

```bash
bunx wrangler deploy
```

Wrangler prints your URL, e.g. `https://opencms-api.<account>.workers.dev`.

## 4. Smoke test

```bash
API=https://opencms-api.<account>.workers.dev

curl $API/health

curl -X POST $API/api/content-types \
  -H 'content-type: application/json' \
  -d '{"name":"article","label":"Article","fields":[{"name":"title","kind":"text","required":true},{"name":"views","kind":"number","indexed":true}]}'

curl -X POST $API/api/content/article \
  -H 'content-type: application/json' \
  -d '{"data":{"title":"Hello from the edge"}}'

curl "$API/api/content/article?sort=createdAt:desc"
```

## Local development against workerd

```bash
cd apps/worker
bunx wrangler dev
```

`wrangler dev` runs the Worker in workerd with a local D1. Note that the
test suite already exercises real workerd D1 via Miniflare
(`packages/connector-d1/test/conformance.test.ts`), so `bun test` at the
repo root is the primary verification loop; `wrangler dev` is for manual
poking.

## Caveats (current milestone)

- No auth yet: do not point this at production content until M3 lands.
- One Worker, one D1 database. Multi-tenant setups deploy one Worker per
  site for now.
