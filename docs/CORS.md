# CORS

A headless CMS is consumed by frontends that do not share its origin, so the
API sends CORS headers by default. The default is deliberately the permissive
one, because for published content it gives away nothing:

```
Access-Control-Allow-Origin: *
```

with credentials off.

Anonymous callers can only ever read published entries. Drafts return 404 by
id or by slug, and list queries are forced to a published-only filter, so a
wildcard exposes exactly what `curl` could already fetch and nothing more.
Because the wildcard is present, browsers refuse to attach cookies, so no
admin session can be ridden from another origin.

## Configuration

Pass a `cors` option to `createApp`:

```ts
import { createApp } from "@opencms/api";

const app = createApp({
  data,
  auth,
  cors: {
    origin: ["https://example.com", "https://www.example.com"],
    credentials: true,
  },
});
```

| Option | Default | Meaning |
|---|---|---|
| `origin` | `"*"` | `"*"`, one origin, an array of origins, or a predicate `(origin) => boolean`. |
| `credentials` | `false` | Allow cookies cross-origin. Ignored when `origin` is `"*"`. |
| `allowHeaders` | `content-type`, `x-api-key`, `authorization` | Request headers a browser may send. |
| `allowMethods` | `GET`, `HEAD`, `POST`, `PATCH`, `PUT`, `DELETE`, `OPTIONS` | Methods a browser may use. |
| `exposeHeaders` | none | Response headers a browser may read beyond the safelisted set. |
| `maxAge` | `86400` | Preflight cache lifetime, in seconds. |

Pass `cors: false` to emit no CORS headers at all, which restores the
same-origin-only behaviour of releases before this option existed.

## Sending cookies cross-origin

Two things must line up, and forgetting the second is the usual cause of a
confusing failure:

1. `cors: { origin: [...], credentials: true }` on `createApp`. The wildcard
   cannot be combined with credentials, and this module will drop
   `credentials` rather than silently narrowing the origin for you.
2. The same origins passed to `createAuth({ trustedOrigins: [...] })`.
   better-auth enforces its own CSRF check on `/api/auth/*` and will reject
   the request before any CORS header matters.

For machine clients, prefer an API key in `x-api-key` over cross-origin
cookies. It sidesteps CSRF entirely and is what the API is designed around.

## Behaviour worth knowing

- A request with no `Origin` header passes through untouched. It is
  same-origin or not from a browser, and CORS has nothing to say about it.
- A disallowed origin gets no CORS headers rather than an error status. The
  request still executes; the browser is what blocks the response. This is
  how CORS is specified to work.
- A preflight always returns 204, allowed or not, so a rejection surfaces as
  a CORS error in the console rather than a misleading 404.
- When `origin` is not the wildcard, responses carry `Vary: Origin` so a
  shared cache cannot serve one origin's response to another.
