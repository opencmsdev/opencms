# Running OpenCMS in Docker

The container is the self-hosted profile in a box: Bun, the API, the prebuilt
admin SPA, and a SQLite file on a volume. One process, one port.

## Quick start

```bash
docker build -t opencms https://github.com/opencmsdev/opencms.git
docker run -d --name opencms \
  -p 3000:3000 \
  -v opencms-data:/data \
  -e BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  opencms
```

Open http://localhost:3000, create the first admin account, and you are
publishing. Content and auth live in `/data/opencms.db` on the `opencms-data`
volume, so the container is disposable and the data is not.

The image refuses to start without `BETTER_AUTH_SECRET`. That is deliberate:
the development fallback secret is public knowledge, and a deployment signing
sessions with it is an account takeover waiting to happen. Generate one and
keep it stable across restarts, or every session is invalidated.

## Media

Uploads need somewhere to live. Point the container at any S3-compatible
bucket, exactly as outside Docker:

```bash
  -e OPENCMS_S3_BUCKET=media \
  -e OPENCMS_S3_ENDPOINT=http://minio:9000 \
  -e OPENCMS_S3_REGION=us-east-1 \
  -e OPENCMS_S3_ACCESS_KEY_ID=... \
  -e OPENCMS_S3_SECRET_ACCESS_KEY=...
```

[MinIO](https://min.io) in a second container is the natural pairing for a
fully self-hosted stack. Without `OPENCMS_S3_BUCKET`, the media library still
works but stores uploads in memory: fine for trying things out, gone on
restart.

## Postgres instead of SQLite

Set `OPENCMS_PG_URL` and content moves to Postgres (Supabase, Neon and plain
connection strings all work); leave it unset for the SQLite file. Auth stays
in the SQLite file either way for now, so keep the volume mounted in both
modes.

```bash
  -e OPENCMS_PG_URL=postgres://user:pass@host:5432/opencms
```

## Cache

`OPENCMS_CACHE=memory` turns on the in-process cache for anonymous published
reads, with `OPENCMS_CACHE_TTL` seconds per entry (default 60). Off by
default: a single-process SQLite read is already fast, so reach for this when
public read traffic, not editing, is the load.

## Every environment variable

| Variable | Default | Meaning |
|---|---|---|
| `BETTER_AUTH_SECRET` | none, required | Session signing secret |
| `OPENCMS_PORT` | `3000` | Listen port |
| `OPENCMS_DB` | `/data/opencms.db` | SQLite path (content + auth) |
| `OPENCMS_PG_URL` | unset | Postgres connection string for content |
| `OPENCMS_S3_BUCKET` and friends | unset | S3-compatible media storage |
| `OPENCMS_CACHE` | unset | `memory` enables the read cache |
| `OPENCMS_CACHE_TTL` | `60` | Cached read lifetime, seconds |
| `BETTER_AUTH_URL` | derived | Canonical URL when behind a proxy |
