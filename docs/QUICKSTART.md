# Quickstart

From nothing to a running CMS with published content you can fetch over HTTP.
Budget about five minutes. Everything here uses the self-hosted profile: Bun
plus a single SQLite file, no services to provision.

To run the same thing on Cloudflare Workers and D1 instead, see
[DEPLOY_CLOUDFLARE.md](./DEPLOY_CLOUDFLARE.md). The code is identical; only
the connector binding differs.

## Prerequisites

- [Bun](https://bun.sh) 1.2 or newer. Nothing else: no Node, no Docker, no
  database server.

## 1. Install

```bash
git clone https://github.com/opencmsdev/opencms.git
cd opencms
bun install
```

## 2. Build the admin UI and start the server

The dev server serves the API and, if it has been built, the admin SPA from
the same origin.

```bash
bun run build:admin
bun run dev
```

```
OpenCMS dev API on http://localhost:3000
```

Content and auth both live in `opencms.dev.db`, created on first run. To put
it somewhere else, set `OPENCMS_DB`. To change the port, set `OPENCMS_PORT`.

> The dev server falls back to a hardcoded auth secret so that `bun run dev`
> works with zero configuration. Anything reachable from the internet must set
> `BETTER_AUTH_SECRET` to a real random value.

## 3. Create the admin account

Open <http://localhost:3000>. On a fresh database the admin UI shows a
first-run setup screen. Fill it in and you are signed in as the admin.

The first account to sign up becomes the admin, and signup then closes
permanently. Further accounts are created from the Users screen.

## 4. Model some content

In the admin, go to **Content types** and create one called `article` with:

| Field | Kind | Notes |
|---|---|---|
| `title` | text | required |
| `body` | richtext | |
| `views` | number | indexed, so it can be filtered and sorted efficiently |

Content types are data, not code. There is no migration and no restart: the
type is usable the moment you save it, and adding a field later behaves the
same way.

## 5. Write and publish an entry

Go to **Entries**, pick `article`, and create one. Fill in the title, then
**Save** and **Publish**. Anonymous readers only ever see published entries,
so this step is what makes it visible in the next one.

## 6. Read it back

Published content needs no credentials:

```bash
curl http://localhost:3000/api/content/article
```

```json
{
  "items": [
    {
      "id": "…",
      "slug": "my-first-article",
      "status": "published",
      "data": { "title": "My first article", "views": 0 },
      "publishedAt": "2026-07-28T10:00:00.000Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

Fetch one by slug, or filter, sort and paginate with query parameters:

```bash
curl "http://localhost:3000/api/content/article/slug/my-first-article"
curl "http://localhost:3000/api/content/article?limit=10&offset=0&sort=publishedAt:desc"
curl "http://localhost:3000/api/content/article?where=$(
  printf '[{"field":"views","op":"gte","value":100}]' | jq -sRr @uri)"
```

`sort` takes `field:asc` or `field:desc`, comma-separated for more than one.
`where` takes URL-encoded JSON: an array of `{field, op, value}` using the
operators `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `nin`, `contains` and
`exists`. Fields marked `indexed` are backed by a JSON expression index, so
filtering on them is a B-tree lookup rather than a scan.

Drafts are invisible to anonymous callers. They are not merely filtered out
of lists: fetching one by id or slug returns 404, so nothing unpublished ever
leaks through a guessed URL.

## 7. Call it from a frontend

The API sends permissive CORS headers by default (`Access-Control-Allow-Origin: *`
with credentials off), so a frontend on any origin can read published content
with no extra configuration:

```js
const res = await fetch("http://localhost:3000/api/content/article");
const { items } = await res.json();
```

To lock that down, or to allow cookies from specific origins, pass a `cors`
option to `createApp`. See [CORS](./CORS.md).

## 8. Write content from a script

Machine clients authenticate with an API key rather than a session. Mint one
in the admin under **API keys**, choosing the `editor` or `admin` role. The
secret is shown once.

```bash
curl -X POST http://localhost:3000/api/content/article \
  -H "x-api-key: $OPENCMS_API_KEY" \
  -H "content-type: application/json" \
  -d '{"status":"published","data":{"title":"Written by a script"}}'
```

An invalid key is a hard 401 rather than a silent downgrade to anonymous, so
a misconfigured client fails loudly instead of mysteriously seeing only
published content.

## Where to go next

- [Deploy to Cloudflare](./DEPLOY_CLOUDFLARE.md), the edge profile on Workers and D1.
- [CORS](./CORS.md), for locking down cross-origin access.
- `DESIGN.md` at the repo root, for the admin UI design system.

## Troubleshooting

**The admin shows a blank page.** The SPA has not been built. Run
`bun run build:admin`, then restart `bun run dev`. Without it the server runs
in API-only mode, which is a valid way to use OpenCMS but has no UI.

**The setup screen does not appear.** The database already has a user. Delete
`opencms.dev.db` (and its `-wal` and `-shm` siblings) to start over.

**A `curl` call to `/api/auth/*` is rejected.** better-auth enforces CSRF on
its own routes, so cookie-authenticated calls need an `Origin` header
matching the server. API keys on `/api/content/*` are unaffected.
