/**
 * Official OpenCMS MCP Worker: Streamable HTTP at https://mcp.opencms.dev/mcp
 *
 * Same D1 + auth secret as the API Worker. API keys minted on the API work
 * here. Sessions do not: cookies are origin-bound to the API host.
 *
 *   wrangler secret put BETTER_AUTH_SECRET
 *   wrangler deploy
 */
import { createMcpApp } from "@opencms/mcp";
import {
  createAuth,
  runAuthMigrations,
  toAuthConnector,
  type AuthDatabase,
} from "@opencms/auth";
import { D1DataConnector, type D1DatabaseLike } from "@opencms/connector-d1";

interface Env {
  DB: D1DatabaseLike;
  BETTER_AUTH_SECRET: string;
  /** Canonical API URL, used only if a session cookie is ever posted here. */
  BETTER_AUTH_URL?: string;
}

let app: ReturnType<typeof createMcpApp> | null = null;
let ready: Promise<unknown> | null = null;

export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    if (!app) {
      const data = new D1DataConnector(env.DB);
      const auth = createAuth({
        database: env.DB as unknown as AuthDatabase,
        secret: env.BETTER_AUTH_SECRET,
        baseURL: env.BETTER_AUTH_URL,
      });
      ready ??= Promise.all([data.init(), runAuthMigrations(auth)]);
      await ready;
      app = createMcpApp({ data, auth: toAuthConnector(auth) });
    }
    return app.fetch(request, env, ctx as never);
  },
};
