# OpenCMS

A modern, open source CMS with the UX WordPress made famous and the architecture 2026 deserves. Edge-native, connector-based, agent-ready.

> Working name. Will be renamed before the first npm publish.

## Architecture

Everything that touches infrastructure is a connector behind an interface:

| Concern | Interface | First-party connectors |
|---|---|---|
| Data | `DataConnector` | SQLite (done), Cloudflare D1, Postgres |
| Object storage | `StorageConnector` | S3-compatible (R2, MinIO, AWS) |
| Compute | plain Hono app | Bun server, Cloudflare Workers |
| Hosting | static admin SPA | anywhere |

### Storage model

Content types are data, not code: they live in the database and are editable from the admin UI. Entries live in a single fixed-schema `entries` table with the typed payload in a JSON column. There is no runtime DDL except `CREATE INDEX`: fields flagged `indexed: true` get a JSON expression index (SQLite/D1), so filtered queries are B-tree lookups, not scans. Validation is enforced in core via Zod, built from the content type definition.

This is what makes connectors small and schema evolution migration-free.

## Packages

- `@opencms/core`: content engine. Types, Zod schema building, `ContentTypeService`, `EntryService`, the connector interfaces, and a reference in-memory connector.
- `@opencms/connector-sqlite`: `DataConnector` on `bun:sqlite`.
- `@opencms/api`: the REST Admin API as a runtime-agnostic Hono app. Runs on Bun and Cloudflare Workers unchanged.
- `@opencms/test-kit`: the conformance suite. A connector is valid if and only if it passes this suite.

## Develop

```bash
bun install
bun test            # everything
bun run typecheck
bun run dev         # local API on http://localhost:3000 backed by SQLite
```

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

1. Core + SQLite + REST API (this repo, now)
2. Cloudflare: D1 + R2 connectors, one-command Workers deploy
3. Admin UI (React, per DESIGN.md), auth via better-auth
4. MCP server surface, Postgres connector, connector SDK docs
