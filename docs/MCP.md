# MCP

OpenCMS speaks [MCP](https://modelcontextprotocol.io) over Streamable HTTP.
Same Hono app as the REST API, same RBAC, same connectors. Official SDK is
[`@modelcontextprotocol/typescript-sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
(`@modelcontextprotocol/server` + `@modelcontextprotocol/hono`).

Official hosted endpoint:

```
https://mcp.opencms.dev/mcp
```

Self-host and the Cloudflare API Worker expose the same path on the API
origin: `http://localhost:3000/mcp`, or `https://<your-api>/mcp`.

## Auth

MCP clients authenticate with an API key, not a session cookie (cookies are
origin-bound; Claude/Cursor/etc. are not browsers on your API host).

| Header | Notes |
|---|---|
| `x-api-key: ocms_…` | Same keys the REST API already uses |
| `Authorization: Bearer ocms_…` | For clients that only send Bearer |

Mint a key as an admin (`POST /api/auth/api-key/create` with
`metadata.role` of `admin` or `editor`). A bad key is HTTP 401, never a
silent downgrade to anonymous.

Access model matches REST:

- Anonymous: published entries only. Schema and drafts are invisible.
- Editor: content (create/update/delete/publish).
- Admin: content types as well.

## Tools

| Tool | Role | What it does |
|---|---|---|
| `list_content_types` | editor | List schema |
| `get_content_type` | editor | Fetch one type by name |
| `create_content_type` | admin | Create a type |
| `update_content_type` | admin | Replace a type (rename is not supported) |
| `delete_content_type` | admin | Delete a type with no entries |
| `list_entries` | public | Query entries; anonymous is published-only |
| `get_entry` | public | Fetch by id |
| `get_entry_by_slug` | public | Fetch by slug |
| `create_entry` | editor | Create |
| `update_entry` | editor | Patch |
| `delete_entry` | editor | Delete |
| `publish_entry` | editor | Set published |
| `unpublish_entry` | editor | Set draft |

## Client config

Cursor / Claude Desktop, pointing at the official cloud:

```json
{
  "mcpServers": {
    "opencms": {
      "url": "https://mcp.opencms.dev/mcp",
      "headers": {
        "Authorization": "Bearer ocms_YOUR_KEY"
      }
    }
  }
}
```

Self-host: swap the URL for `http://localhost:3000/mcp` (dev server) or
your API Worker's origin plus `/mcp`.

## Deploy the official Worker

`apps/mcp` is a dedicated Worker with the custom domain `mcp.opencms.dev`.
It binds the **same D1** as `apps/worker` and must use the **same**
`BETTER_AUTH_SECRET`, or API key verification fails.

```bash
cd apps/mcp
# Paste the API Worker's D1 database_id into wrangler.toml
openssl rand -base64 32 | bunx wrangler secret put BETTER_AUTH_SECRET
# or reuse the API secret: wrangler secret put BETTER_AUTH_SECRET
bunx wrangler deploy
```

The zone `opencms.dev` has to live on that Cloudflare account for the
custom domain route to bind. Until it does, Wrangler still prints a
`*.workers.dev` URL that serves `/mcp`.

Self-host needs no extra process: `apps/dev` and `apps/worker` already
dispatch `/mcp` to `createMcpApp`.

## Embed it yourself

`createMcpApp` returns a Hono app, so it runs anywhere Hono runs (Bun,
Workers, Node, Deno):

```ts
import { createMcpApp } from "@opencms/mcp";

const mcp = createMcpApp({ data, auth });
export default mcp;
```

Default bind is `host: "0.0.0.0"` so a public hostname is not rejected by
the SDK's localhost DNS-rebinding guard. A local-only process can pass
`mcp: { host: "127.0.0.1" }` to turn that guard back on.
