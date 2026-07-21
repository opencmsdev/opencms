/**
 * Cloudflare Workers entrypoint: the same Hono app the Bun dev server runs,
 * bound to D1. This file is the entire "Compute: Cloudflare" story.
 */
import type { Hono } from "hono";
import { createApp } from "@opencms/api";
import { D1DataConnector, type D1DatabaseLike } from "@opencms/connector-d1";

interface Env {
  DB: D1DatabaseLike;
}

let app: Hono | null = null;
let ready: Promise<void> | null = null;

export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    if (!app) {
      const data = new D1DataConnector(env.DB);
      ready ??= data.init();
      await ready;
      app = createApp({ data });
    }
    // Hono types ctx as its own ExecutionContext; the runtime object matches.
    return app.fetch(request, env, ctx as never);
  },
};
