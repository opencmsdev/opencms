import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { createMcpHonoApp, type CreateMcpHonoAppOptions } from "@modelcontextprotocol/hono";
import {
  ContentTypeService,
  EntryService,
  UnauthorizedError,
  VERSION,
  type DataConnector,
} from "@opencms/core";
import { cors, type AuthConnector, type CorsOptions } from "@opencms/api";
import { resolveActor } from "./actor.ts";
import { registerContentTools } from "./tools.ts";

export { cors, type CorsOptions } from "@opencms/api";

const MCP_ALLOW_HEADERS = [
  "content-type",
  "accept",
  "x-api-key",
  "authorization",
  "mcp-protocol-version",
  "mcp-session-id",
];
const MCP_EXPOSE_HEADERS = ["mcp-session-id", "mcp-protocol-version"];

export interface CreateMcpAppOptions {
  data: DataConnector;
  auth: AuthConnector;
  /**
   * Cross-origin access for browser MCP inspectors. Defaults to `origin: "*"`
   * with credentials off. Pass `false` to emit no CORS headers.
   */
  cors?: CorsOptions | false;
  /**
   * Host / DNS-rebinding knobs for `@modelcontextprotocol/hono`.
   * Default `host: "0.0.0.0"` so a public Worker (mcp.opencms.dev) is not
   * rejected by the localhost-only default.
   */
  mcp?: CreateMcpHonoAppOptions;
}

/** True for `/mcp` and anything under it. */
export function isMcpPath(pathname: string): boolean {
  return pathname === "/mcp" || pathname.startsWith("/mcp/");
}

/**
 * The MCP surface as a runtime-agnostic Hono app.
 *
 * Official cloud:  https://mcp.opencms.dev/mcp  (apps/mcp Worker)
 * Self-host:       mount next to the REST API, same `/mcp` path
 *
 * Auth: `x-api-key` or `Authorization: Bearer`. Same RBAC as REST.
 */
export function createMcpApp(opts: CreateMcpAppOptions) {
  const types = new ContentTypeService(opts.data);
  const entries = new EntryService(opts.data);
  const actors = new WeakMap<Request, Awaited<ReturnType<typeof resolveActor>>>();

  const handler = createMcpHandler(async (ctx) => {
    const req = ctx.requestInfo;
    const actor = req
      ? (actors.get(req) ?? (await resolveActor(opts.auth, req.headers)))
      : await resolveActor(opts.auth, new Headers());
    const server = new McpServer(
      { name: "opencms", version: VERSION },
      {
        instructions:
          "OpenCMS content tools. Authenticate with an `x-api-key` header or `Authorization: Bearer <key>`. Anonymous clients can only read published entries. Editors manage content. Admins also manage content types.",
      }
    );
    registerContentTools(server, { types, entries, actor });
    return server;
  });

  const app = createMcpHonoApp({ host: "0.0.0.0", ...opts.mcp });

  if (opts.cors !== false) {
    const corsOpts = opts.cors ?? {};
    app.use(
      "*",
      cors({
        ...corsOpts,
        allowHeaders: corsOpts.allowHeaders ?? MCP_ALLOW_HEADERS,
        exposeHeaders: corsOpts.exposeHeaders ?? MCP_EXPOSE_HEADERS,
      })
    );
  }

  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) {
      return c.json({ error: err.code, message: err.message }, 401);
    }
    console.error(err);
    return c.json({ error: "internal", message: "internal server error" }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true, name: "opencms-mcp", version: VERSION }));

  const serve = async (c: { req: { raw: Request }; get: (k: string) => unknown }) => {
    const actor = await resolveActor(opts.auth, c.req.raw.headers);
    actors.set(c.req.raw, actor);
    return handler.fetch(c.req.raw, { parsedBody: c.get("parsedBody") });
  };

  app.all("/mcp", (c) => serve(c));
  app.all("/mcp/*", (c) => serve(c));

  return app;
}
