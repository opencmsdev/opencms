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

### Added

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

[Unreleased]: https://github.com/opencmsdev/opencms/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/opencmsdev/opencms/releases/tag/v0.1.0
