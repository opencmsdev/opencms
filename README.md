# OpenCMS

A modern, open source CMS with the UX WordPress made famous and the architecture 2026 deserves. Edge-native, connector-based, agent-ready.

[![CI](https://github.com/opencmsdev/opencms/actions/workflows/ci.yml/badge.svg)](https://github.com/opencmsdev/opencms/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**[Quickstart](./docs/QUICKSTART.md)** for a running CMS in five minutes,
**[deploy to Cloudflare](./docs/DEPLOY_CLOUDFLARE.md)** for the edge profile, or
**[connect an agent](./docs/MCP.md)** at `https://mcp.opencms.dev/mcp`.

## Architecture

Everything that touches infrastructure is a connector behind an interface:

| Concern | Interface | First-party connectors |
|---|---|---|
| Data | `DataConnector` | SQLite (done), Cloudflare D1 (done), Postgres |
| Object storage | `StorageConnector` | S3-compatible (R2, MinIO, AWS) |
| Auth | better-auth (same SQLite/D1 database) | done |
| Compute | plain Hono app | Bun server, Cloudflare Workers (API + MCP) |
| Hosting | static admin SPA (done, served by both profiles) | anywhere |
| Agents | MCP Streamable HTTP | `@opencms/mcp`, official cloud at mcp.opencms.dev |

### Storage model

Content types are data, not code: they live in the database and are editable from the admin UI. Entries live in a single fixed-schema `entries` table with the typed payload in a JSON column. There is no runtime DDL except `CREATE INDEX`: fields flagged `indexed: true` get a JSON expression index (SQLite/D1), so filtered queries are B-tree lookups, not scans. Validation is enforced in core via Zod, built from the content type definition.

This is what makes connectors small and schema evolution migration-free.

### Access model

better-auth is mounted at `/api/auth/*` on the same Hono app, with its tables in the same database as the content. Two roles: admin and editor.

- Anonymous requests read published entries only; drafts and schema are invisible.
- Editors (email/password sessions, or API keys sent as `x-api-key`) manage content.
- Admins additionally manage content types, users and API keys. API keys carry a role (admin or editor) set at creation.
- Bootstrap: the first signup becomes the admin, then signup closes; admins create further accounts via `/api/auth/admin/create-user`.

## Packages

- `@opencms/core`: content engine. Types, Zod schema building, `ContentTypeService`, `EntryService`, the connector interfaces, and a reference in-memory connector.
- `@opencms/sqlite-dialect`: the SQL shared by all SQLite-family connectors. Pure functions, no driver imports.
- `@opencms/connector-sqlite`: `DataConnector` on `bun:sqlite` (self-hosted profile).
- `@opencms/connector-d1`: `DataConnector` on Cloudflare D1. Conformance runs against real workerd via Miniflare. See `docs/DEPLOY_CLOUDFLARE.md`.
- `@opencms/auth`: better-auth configured for OpenCMS. Email/password sessions, API keys with roles, admin/editor RBAC, first-signup bootstrap, idempotent migrations for bun:sqlite and D1.
- `@opencms/api`: the REST Admin API as a runtime-agnostic Hono app. Runs on Bun and Cloudflare Workers unchanged.
- `@opencms/mcp`: the MCP agent surface as a Hono app, built on the official TypeScript SDK. Official cloud lives at `https://mcp.opencms.dev/mcp`; self-host mounts `/mcp` on the API. See `docs/MCP.md`.
- `@opencms/test-kit`: the conformance suite. A connector is valid if and only if it passes this suite.
- `@opencms/admin` (apps/admin): the admin SPA. React + Vite + Tailwind v4 + shadcn components restyled per DESIGN.md (dark canvas, pills, hairlines, weight 400). First-run setup, sign-in, content-type builder, entry list and editor with draft/publish, users, API keys. Playwright E2E against the real Bun + SQLite stack.
- `opencms` (packages/cli): the CLI. `opencms init` walks stack choices into
  a clone and `opencms.config.ts`; `opencms setup` asks each integration to
  provision itself (D1, R2, `.env`, secrets).

## Set up with an agent

```bash
bunx opencms init      # or: npx opencms init
cd <project> && bunx opencms setup
```

The wizard asks what you want: the backend is required (self-hosted Bun +
SQLite, or Cloudflare Workers + D1), the frontend host, a CDN cache, and
object storage (S3 or R2) are optional. It then collects the data each
choice needs (URLs, ports, worker and database names, CORS origins, TTL,
bucket, admin account), clones this repository into `./<project>`, and
records the choices in `opencms.config.ts`. Next, `opencms setup` reads
that file and each integration provisions itself: `.env` and a generated
`BETTER_AUTH_SECRET` for Bun, D1 + wrangler secrets for Cloudflare, S3
keys or an R2 bucket when storage is declared. Each integration then tests
the connection (D1 `SELECT 1`, S3/R2 ListObjects with those keys). Secrets never go in
`opencms.config.ts`. The wizard also prints a complete prompt for a coding
agent (Claude Code, Cursor, ...) that finishes CORS / admin bootstrap; the
prompt is copied to your clipboard and saved to `opencms-agent-prompt.md`
in the project folder (`--out <file>` to change, `--no-write` to print
only, `--no-setup` to skip the clone and only generate the prompt).

Secrets never leave your machine: generated secrets live in untracked
`.env` / `.dev.vars`, the prompt never contains one, and the agent is
instructed to create the admin password at setup time and keep it out of
git. Until the package is published to npm, run it from a checkout with
`bun run cli init` / `bun run cli setup`.

## Develop

```bash
bun install
bun run test:all       # typecheck + unit + E2E, the whole gate in one command
bun run dev            # local API on http://localhost:3000 backed by SQLite

cd apps/admin && bun run dev   # UI development with hot reload (proxies /api to :3000)
```

Individual steps:

```bash
bun run test:unit      # bun:test: core, fields, services, connector conformance
bun run typecheck      # root tsc + apps/admin tsc (specs included)
bun run test:e2e       # builds the admin SPA, then runs Playwright against it
bun run build:admin    # build the admin SPA; the dev server then serves it at /
```

### Tests

Two layers, both required before a change lands.

`bun run test:unit` runs `bun test packages`. Do not run bare `bun test` at the
root: it would sweep in the Playwright spec files, which need their own runner.
The connector conformance suite in `@opencms/test-kit` is the contract every
data connector must satisfy, and the D1 connector runs it against real workerd
through Miniflare.

`bun run test:e2e` drives the built admin SPA against a real Bun and SQLite
stack on a throwaway database. The suite is deliberately serial: one server,
one database, wiped once at the start, with spec files running in alphabetical
order. `admin.spec.ts` establishes the baseline (bootstrap admin, an editor,
the `article` type) and each later file inherits that state, so **name any new
spec file so it sorts after `admin.spec.ts`** and give it its own content type
when it needs to create or delete schema. Shared fixtures and helpers live in
`apps/admin/e2e/helpers.ts`.

Set `PW_CHROMIUM_PATH` to reuse a preinstalled Chromium instead of the managed
download, which is what CI images and sandboxes usually want.

First run: open http://localhost:3000 (with the admin built) and the setup screen creates the admin account, then signup closes. Or bootstrap over HTTP: `curl -X POST localhost:3000/api/auth/sign-up/email -H 'content-type: application/json' -d '{"email":"you@example.com","password":"a-strong-password","name":"You"}'`.

## Writing a connector

Implement `DataConnector` from `@opencms/core`, then prove it:

```ts
import { runDataConnectorSuite } from "@opencms/test-kit";
runDataConnectorSuite("my-connector", async () => ({
  connector: await makeMyConnector(),
  cleanup: async (c) => c.close(),
}));
```

## Roadmap

Tracked in Linear (project OpenCMS).

1. ~~M1: core + SQLite + REST API~~ done
2. ~~M2: Cloudflare, D1 connector~~ done; R2 comes with media (M5)
3. ~~M3: auth (better-auth sessions, API keys, RBAC)~~ done
4. ~~M4: admin UI (React + shadcn per DESIGN.md), Playwright E2E~~ done
5. M5: media, S3-compatible storage connector (R2, MinIO, AWS)
6. M6: MCP server surface; then Postgres connector + connector SDK docs

## Docs

- [Quickstart](./docs/QUICKSTART.md): install, model content, publish, read it back over HTTP.
- [Deploy to Cloudflare](./docs/DEPLOY_CLOUDFLARE.md): the edge profile on Workers and D1.
- [CORS](./docs/CORS.md): cross-origin access for browser frontends.
- [DESIGN.md](./DESIGN.md): the admin UI design system.

## License

MIT. See [LICENSE](./LICENSE).
