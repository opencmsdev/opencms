# MCP

OpenCMS speaks [MCP](https://modelcontextprotocol.io) over Streamable HTTP.
Same Hono app as the REST API, same RBAC, same connectors. Official SDK is
[`@modelcontextprotocol/typescript-sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
(`@modelcontextprotocol/server` + `@modelcontextprotocol/hono`).

Every instance already serves MCP at `/mcp` on the API origin. There is no
second process to install and you do not point clients at the hosted
`mcp.opencms.dev` endpoint. That hostname is OpenCMS's own cloud. Yours is:

```
http://localhost:3000/mcp
```

or, once deployed, `https://<your-api>/mcp`.

## Add it to a client

1. Run your OpenCMS instance ([quickstart](./QUICKSTART.md) locally, or your
   deployed API).
2. Sign in as an admin, open **API keys**, mint a key. Copy it now; the
   secret is shown once.
3. Point the MCP client at **your** `/mcp` URL and send that key on every
   request.

Editor keys can manage content. Admin keys can also manage content types.

### Cursor

Cursor Settings → Tools & MCP → New MCP Server, or write the same JSON to
`.cursor/mcp.json` (this project) or `~/.cursor/mcp.json` (every project):

```json
{
  "mcpServers": {
    "opencms": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer ocms_YOUR_KEY"
      }
    }
  }
}
```

For a deployed instance, swap the URL for `https://<your-api>/mcp`. If the
file is committed, interpolate the secret instead of pasting it:

```json
"Authorization": "Bearer ${env:OPENCMS_API_KEY}"
```

Restart Cursor (or reload MCP servers from that settings page) after saving.
The `opencms` server should go green and expose the tools below.

### Claude Desktop

Same `mcpServers` object, in Claude's config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Then restart Claude Desktop.

### Claude Code

Project-root `.mcp.json`, same shape as Cursor's `mcpServers` block.

## Auth

MCP clients authenticate with an API key, not a session cookie (cookies are
origin-bound; Claude/Cursor/etc. are not browsers on your API host).

| Header | Notes |
|---|---|
| `x-api-key: ocms_…` | Same keys the REST API already uses |
| `Authorization: Bearer ocms_…` | For clients that only send Bearer |

A bad key is HTTP 401, never a silent downgrade to anonymous.

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

## Already on the API

Local `apps/dev` and the Cloudflare API Worker both dispatch `/mcp` to
`createMcpApp`. A self-hosted or Worker deploy does not need `apps/mcp`;
that Worker is only the public `mcp.opencms.dev` hostname.

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
