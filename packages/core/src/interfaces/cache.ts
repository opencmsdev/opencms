/**
 * Key-value cache contract. First implementation is Cloudflare KV; the
 * in-memory reference in core defines the semantics.
 *
 * Deliberately three calls and strings only. Invalidation is built on
 * generation counters (bump one key) rather than prefix scans, because KV
 * cannot delete by prefix without a slow, eventually-consistent list walk.
 *
 * Consistency: a cache may be eventually consistent across regions (KV is).
 * Core only caches anonymous published reads, where bounded staleness is an
 * acceptable trade; TTLs bound the staleness window.
 */
export interface CacheConnector {
  /** null for a missing or expired key. */
  get(key: string): Promise<string | null>;
  /**
   * Store a value. `ttlSeconds` is a floor the backend may round up:
   * Cloudflare KV enforces a 60 second minimum, and the connector clamps
   * rather than erroring so callers can express intent portably.
   */
  set(key: string, value: string, opts?: { ttlSeconds?: number }): Promise<void>;
  /** Deleting a missing key is a no-op. */
  delete(key: string): Promise<void>;
}
