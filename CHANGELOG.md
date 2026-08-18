# Changelog

All notable changes to OpenCMS, in the format of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); while this is 0.x,
breaking changes land in minor releases.

The whole repository shares one version. Nothing is published to npm
independently, so every package moves together. `bun run sync:version`
propagates the root `package.json` version to every package and to
`packages/core/src/version.ts`, which is what `/health` and the admin sidebar
report. Run it after changing the version and commit the result.

## [Unreleased]

## [0.3.0] - 2026-08-18

### Added

- MCP agent surface (`@opencms/mcp`). Streamable HTTP via the official
  TypeScript SDK and a Hono app, so the same code runs on Bun and on
  Cloudflare Workers. Tools cover content types and entries with the same
  RBAC as REST (`x-api-key` or `Authorization: Bearer`). Official cloud
  endpoint is `https://mcp.opencms.dev/mcp` (`apps/mcp`); self-host and the
  API Worker expose `/mcp` on the API origin. See `docs/MCP.md`.
- `opencms setup` reads `opencms.config.ts` and asks each integration to
  provision itself: Bun writes `.env`, Cloudflare creates D1 and stores
  secrets, S3/R2 ask for keys. Each integration then `test()`s the
  connection (D1 `SELECT 1`, S3/R2 ListObjects with the stored keys).
  Safe to re-run. Run `bunx @opencms/cli setup` after `opencms init` (needs
  Bun so the TypeScript config can be imported). The npm package is
  `@opencms/cli` because unscoped `opencms` is too similar to `open-cms`.

### Changed

- `opencms.config.ts` is now written as typed integrations (`defineConfig`,
  `bunSqlite()`, `vercel()`, `cloudflareCdn()`, `s3()`, ...) instead of a
  JSON object with string discriminators, the same shape as better-auth
  plugins. Each factory owns its own `plan` / `setup` / `test`; the CLI
  only walks those methods.

### Fixed

- In the content type builder, the default-value input now takes the field's
  own shape: a boolean offers true/false, a select offers its own options, a
  number and a date get native inputs, JSON and rich text get textareas.
  Previously every kind got a plain text box, so a boolean default read as
  free text. Switching a field's kind also clears a default typed for the
  previous kind.

## [0.2.0] - 2026-08-11

### Added

- `opencms init`: an interactive CLI wizard (`npx opencms init` or `bunx
  opencms init`) that picks your stack, backend, frontend host and cache,
  clones the project, writes `opencms.config.ts` plus the profile config
  (`.env` or `wrangler.toml`), and hands you an agent-ready setup prompt,
  copied to the clipboard. `--no-setup` generates the prompt only.
- Media library (M5). Upload, browse, pick and delete files from the admin,
  backed by any storage connector. Uploads land under date-prefixed keys that
  never collide, media fields get a visual picker with previews, and files are
  served publicly at `GET /api/media/<key>`, matching how published entries are
  readable without a token. Backends with a public base URL (an R2 custom
  domain, say) serve their own bytes via redirect instead of proxying.
- `POST /api/media` (multipart upload), `GET /api/media` (paged listing) and
  `DELETE /api/media/<key>` for editors; `GET /api/setup` now reports whether
  media is configured so clients can show or hide the library.
- The Bun dev server and the Cloudflare Worker wire storage from
  `OPENCMS_S3_*` environment variables; without them the dev server falls back
  to in-memory storage so the library works out of the box.
- Docker image. A multi-stage `Dockerfile` ships the self-hosted profile as a
  container: Bun, the API, the prebuilt admin, and the SQLite file on a
  `/data` volume, with media, Postgres and the cache configured through the
  same environment variables as everywhere else. The image refuses to start
  without a real `BETTER_AUTH_SECRET`. See `docs/DOCKER.md`.
- Cache layer. `CacheConnector` joins data and storage as the third connector
  contract, with a conformance suite, an in-memory reference in core, and a
  Cloudflare Workers KV connector (`@opencms/connector-kv`) proven against
  workerd via Miniflare. Pass `createApp({ cache })` and anonymous published
  reads are cached with per-type generation invalidation: every write to a
  type invalidates its reads with a single key bump, no prefix scans. The
  Worker picks it up from a `CACHE` KV binding, the dev server from
  `OPENCMS_CACHE=memory`; off by default everywhere.
- Postgres connector (`@opencms/connector-postgres`), built on Bun's own SQL
  client with zero external dependencies. One connector covers anything that
  speaks the Postgres wire protocol: self-hosted Postgres, Supabase, Neon,
  RDS. Entry data lives in `jsonb` with typed comparisons, so filters and
  sorts behave identically to the SQLite and D1 connectors, proven by the
  same conformance suite run against a real server. The dev server picks it
  up from `OPENCMS_PG_URL`.
- S3-compatible object storage connector (`@opencms/connector-s3`), usable with
  Cloudflare R2, MinIO and AWS. Signs with SigV4 over `fetch` so it runs
  unchanged on Bun and on Cloudflare Workers.
- Storage connectors now have a conformance suite, so a storage connector is
  valid exactly when it passes it, matching the rule data connectors already
  followed. An in-memory reference implementation ships in `@opencms/core`.
- `GET /health` reports the running version, and the admin sidebar shows it.
- CORS on the content API, so a browser frontend on another origin can read
  published content. Permissive by default; configurable per origin.
- Quickstart, CORS and public-demo guides, plus a docs site at opencms.dev/docs.
- MIT licence.

### Changed

- **Breaking:** listing a storage connector no longer guarantees `contentType`,
  because S3 listings do not carry one. Call `head()` when you need it for
  certain.
- **Breaking:** `put()` on a storage connector takes an optional
  `contentLength`. Without it, a stream of unknown length has to be buffered in
  memory, because S3 rejects a streamed upload that does not declare its size.

### Fixed

- Editing an entry immediately after creating it no longer silently discards
  your changes. A late-arriving fetch could overwrite what you had typed, and
  the next save would persist the reverted text with no error shown.
- Long titles no longer produce a slug the API then rejects.
- A required JSON field is now actually enforced.
- The sign-in screen reports a wrong password instead of a generic failure.
- The boolean entry field is reachable with a screen reader.

## [0.1.0] - 2026-07-21

First tracked release, covering milestones M1 through M4. Reconstructed from
the milestone history rather than written at the time, so it is a summary
rather than a full account.

### Added

- Content engine: content types as data, entries validated on the way in, slug
  derivation and collision handling, unique fields, and publish/unpublish with a
  stable `publishedAt`. Adding a field needs no migration.
- SQLite data connector for the self-hosted profile, and a Cloudflare D1
  connector for the edge, sharing one SQL dialect. Both pass the connector
  conformance suite.
- REST Admin API as a runtime-agnostic Hono app, running on Bun and on
  Cloudflare Workers from the same source.
- Authentication: email and password sessions, API keys for machine access, and
  two roles. Anonymous callers read published entries only; drafts return 404
  rather than being filtered from lists.
- Admin UI in React: first-run setup, content type builder, entry editor with
  draft and publish, user management and API keys.

[Unreleased]: https://github.com/opencmsdev/opencms/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/opencmsdev/opencms/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/opencmsdev/opencms/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/opencmsdev/opencms/releases/tag/v0.1.0
