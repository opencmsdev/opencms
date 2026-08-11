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
import { KVCacheConnector, type KVNamespaceLike } from "@opencms/connector-kv";
import { S3StorageConnector } from "@opencms/connector-s3";
import type { StorageConnector } from "@opencms/core";

interface Env {
  DB: D1DatabaseLike;
  /**
   * Anonymous read cache (optional): bind a KV namespace as CACHE in
   * wrangler.toml and published reads are cached at the edge for
   * OPENCMS_CACHE_TTL seconds (default 60).
   */
  CACHE?: KVNamespaceLike;
  OPENCMS_CACHE_TTL?: string;
  BETTER_AUTH_SECRET: string;
  /** Optional canonical URL, e.g. https://opencms-api.example.workers.dev */
  BETTER_AUTH_URL?: string;
  /**
   * Media storage (optional): an R2 or other S3-compatible bucket. Set the
   * bucket as a var and the two keys as secrets:
   *   wrangler secret put OPENCMS_S3_ACCESS_KEY_ID
   *   wrangler secret put OPENCMS_S3_SECRET_ACCESS_KEY
   */
  OPENCMS_S3_BUCKET?: string;
  OPENCMS_S3_ENDPOINT?: string;
  OPENCMS_S3_ACCOUNT_ID?: string;
  OPENCMS_S3_REGION?: string;
  OPENCMS_S3_ACCESS_KEY_ID?: string;
  OPENCMS_S3_SECRET_ACCESS_KEY?: string;
  OPENCMS_S3_PUBLIC_BASE_URL?: string;
}

function storageFromEnv(env: Env): StorageConnector | undefined {
  if (!env.OPENCMS_S3_BUCKET) return undefined;
  return new S3StorageConnector({
    bucket: env.OPENCMS_S3_BUCKET,
    endpoint: env.OPENCMS_S3_ENDPOINT,
    accountId: env.OPENCMS_S3_ACCOUNT_ID,
    region: env.OPENCMS_S3_REGION,
    accessKeyId: env.OPENCMS_S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.OPENCMS_S3_SECRET_ACCESS_KEY ?? "",
    publicBaseUrl: env.OPENCMS_S3_PUBLIC_BASE_URL,
  });
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
      app = createApp({
        data,
        auth: toAuthConnector(auth),
        storage: storageFromEnv(env),
        cache: env.CACHE
          ? {
              connector: new KVCacheConnector(env.CACHE),
              ttlSeconds: Number(env.OPENCMS_CACHE_TTL ?? "") || undefined,
            }
          : undefined,
      });
    }
    // Hono types ctx as its own ExecutionContext; the runtime object matches.
    return app.fetch(request, env, ctx as never);
  },
};
