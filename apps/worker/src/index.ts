/**
 * Cloudflare Workers entrypoint: the same Hono app the Bun dev server runs,
 * bound to D1. Auth tables live in the same D1 database as the content.
 *
 * Requires a secret: `wrangler secret put BETTER_AUTH_SECRET`.
 */
import { createApp } from "@opencms/api";
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
  /** Optional canonical URL, e.g. https://opencms-api.example.workers.dev */
  BETTER_AUTH_URL?: string;
}

let app: ReturnType<typeof createApp> | null = null;
let ready: Promise<unknown> | null = null;

export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    if (!app) {
      const data = new D1DataConnector(env.DB);
      const auth = createAuth({
        // Same binding, wider structural type on our side.
        database: env.DB as unknown as AuthDatabase,
        secret: env.BETTER_AUTH_SECRET,
        baseURL: env.BETTER_AUTH_URL,
      });
      // Both inits are idempotent DDL; run once per isolate.
      ready ??= Promise.all([data.init(), runAuthMigrations(auth)]);
      await ready;
      app = createApp({ data, auth: toAuthConnector(auth) });
    }
    // Hono types ctx as its own ExecutionContext; the runtime object matches.
    return app.fetch(request, env, ctx as never);
  },
};
