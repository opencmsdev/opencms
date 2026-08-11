import type { CacheConnector } from "../interfaces/cache.ts";
import type { Clock } from "../services/content-types.ts";

/**
 * In-memory reference implementation of `CacheConnector`. Defines the
 * contract the way MemoryDataConnector and MemoryStorageConnector do for
 * theirs, and doubles as a perfectly good single-process cache for the
 * self-hosted Bun profile.
 *
 * Expiry is lazy: an expired record dies when read. Nothing sweeps in the
 * background, so a long-lived process caching unbounded distinct keys should
 * prefer a real backend.
 */
export class MemoryCacheConnector implements CacheConnector {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  /** Injected so tests can pin time, mirroring the `Clock` in core's services. */
  constructor(private now: Clock = () => new Date()) {}

  async get(key: string): Promise<string | null> {
    const record = this.store.get(key);
    if (!record) return null;
    if (record.expiresAt !== null && this.now().getTime() >= record.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return record.value;
  }

  async set(key: string, value: string, opts: { ttlSeconds?: number } = {}): Promise<void> {
    const expiresAt =
      opts.ttlSeconds === undefined ? null : this.now().getTime() + opts.ttlSeconds * 1000;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}
