# OpenCMS

A modern, open source CMS with the UX WordPress made famous and the architecture 2026 deserves. Edge-native, connector-based, agent-ready.

> Working name. Will be renamed before the first npm publish.

## Architecture

Everything that touches infrastructure is a connector behind an interface:

| Concern | Interface | First-party connectors |
|---|---|---|
| Data | `DataConnector` | SQLite (done), Cloudflare D1 (done), Postgres |
| Object storage | `StorageConnector` | S3-compatible (R2, MinIO, AWS) |
| Auth | better-auth (same SQLite/D1 database) | done |
| Compute | plain Hono app | Bun server, Cloudflare Workers |
| Hosting | static admin SPA | anywhere |

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
- `@opencms/test-kit`: the conformance suite. A connector is valid if and only if it passes this suite.

## Develop

```bash
bun install
bun test            # everything
bun run typecheck
bun run dev         # local API on http://localhost:3000 backed by SQLite
```

First run: `curl -X POST localhost:3000/api/auth/sign-up/email -H 'content-type: application/json' -d '{"email":"you@example.com","password":"a-strong-password","name":"You"}'` creates the admin.

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
4. M4: admin UI (React, per DESIGN.md), Playwright E2E
5. M5: media, S3-compatible storage connector (R2, MinIO, AWS)
6. M6: MCP server surface; then Postgres connector + connector SDK docs
