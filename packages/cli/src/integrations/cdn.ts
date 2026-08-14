import type { CacheConfig } from "../config.ts";
import { note } from "../setup-context.ts";

export type CdnOptions = {
  ttlSeconds: number;
};

export function cloudflareCdn(options: CdnOptions): CacheConfig {
  return cdn("cloudflare-cdn", options);
}

export function otherCdn(options: CdnOptions): CacheConfig {
  return cdn("other-cdn", options);
}

function cdn(kind: CacheConfig["kind"], options: CdnOptions): CacheConfig {
  return {
    kind,
    ...options,
    plan() {
      return ["CDN cache: note only (Cache Rules are set in the dashboard)"];
    },
    async setup(ctx) {
      note(
        ctx,
        `CDN cache (${this.kind}, TTL ${this.ttlSeconds}s): add a Cache Rule for GET /api/content/* in the dashboard. Authenticated requests must bypass it.`,
      );
    },
    async test() {
      // Cache Rules live in the dashboard; nothing to ping from here.
    },
  };
}
