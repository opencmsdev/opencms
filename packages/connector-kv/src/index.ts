import type { CacheConnector } from "@opencms/core";

/**
 * `CacheConnector` over Cloudflare Workers KV.
 *
 * Structural binding type rather than @cloudflare/workers-types, matching how
 * the D1 connector stays decoupled: anything with these three methods is a
 * valid namespace, which is also what makes the Miniflare conformance test
 * possible without type gymnastics.
 */
export interface KVNamespaceLike {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** KV rejects TTLs under 60 seconds; clamp so intent stays portable. */
const KV_MIN_TTL_SECONDS = 60;

export class KVCacheConnector implements CacheConnector {
  constructor(private readonly kv: KVNamespaceLike) {}

  async get(key: string): Promise<string | null> {
    return this.kv.get(key, "text");
  }

  async set(key: string, value: string, opts: { ttlSeconds?: number } = {}): Promise<void> {
    await this.kv.put(
      key,
      value,
      opts.ttlSeconds === undefined
        ? undefined
        : { expirationTtl: Math.max(opts.ttlSeconds, KV_MIN_TTL_SECONDS) }
    );
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }
}
