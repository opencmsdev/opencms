# Running the public demo

A throwaway OpenCMS instance on Cloudflare Workers and D1, seeded with sample
content and reset on a schedule. This is what a "Try it" link on the site
should point at.

It is a second deployment, deliberately separate from anything real: it has
published admin credentials, so treat it as hostile territory and never point
it at a database you care about.

## 1. Create the demo database

```bash
cd apps/worker
bunx wrangler login
bunx wrangler d1 create opencms-demo
```

Copy the returned `database_id`. Rather than editing `wrangler.toml`, which
belongs to your real deployment, keep the demo in its own environment file so
the two can never be confused:

```toml
# apps/worker/wrangler.demo.toml
name = "opencms-demo"
main = "src/index.ts"
compatibility_date = "2026-07-01"

[assets]
directory = "../admin/dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*", "/health"]

[[d1_databases]]
binding = "DB"
database_name = "opencms-demo"
database_id = "PASTE_THE_DEMO_DATABASE_ID"
```

## 2. Set the auth secret

```bash
openssl rand -base64 32 | bunx wrangler secret put BETTER_AUTH_SECRET -c wrangler.demo.toml
```

## 3. Build the admin and deploy

```bash
bun run --cwd ../.. build:admin
bunx wrangler deploy -c wrangler.demo.toml
```

The schema needs no migration step. The Worker creates the content and auth
tables on first request, and both inits are idempotent.

## 4. Seed it

The first signup on an empty database becomes the admin, which is exactly
what the seed script does:

```bash
OPENCMS_URL=https://opencms-demo.<your-subdomain>.workers.dev \
OPENCMS_EMAIL=demo@opencms.dev \
OPENCMS_PASSWORD='demo-password-123456' \
  bun run seed:demo
```

It creates an `article` and a `changelog` type, three published articles, one
draft (so the demo can show that drafts 404 rather than merely being filtered
out), and a changelog entry. Re-running it updates in place instead of
duplicating, so it is safe to point at a live demo.

Publish those credentials on the demo page. They are the point.

## 5. Check it

```bash
curl https://opencms-demo.<your-subdomain>.workers.dev/api/content/article
curl -o /dev/null -w '%{http_code}\n' \
  https://opencms-demo.<your-subdomain>.workers.dev/api/content/article/slug/an-unpublished-draft
# 404, because anonymous callers never see drafts
```

## 6. Reset it on a schedule

A public demo with published admin credentials will be vandalised, so wipe it
nightly. `.github/workflows/demo-reset.yml` does this: it drops every table,
pokes the Worker once so the schema is recreated, then re-seeds.

It needs three repository secrets: `CLOUDFLARE_API_TOKEN` (with D1 edit
permission), `DEMO_URL`, and `DEMO_PASSWORD`. Run it manually from the
Actions tab once before trusting the schedule.

## What the demo does not cover

Media uploads (M5) and the MCP surface (M6) are not built yet, so the media
field renders as a plain storage-key input and there is nothing agent-facing
to show. Say so on the demo page rather than letting a visitor find out by
clicking.
