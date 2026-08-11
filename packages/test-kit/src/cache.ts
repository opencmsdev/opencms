/**
 * The cache connector conformance suite.
 *
 * A CacheConnector is valid if and only if this suite passes against it,
 * the same rule the data and storage suites apply.
 *
 *   runCacheConnectorSuite("kv", async () => ({
 *     connector: makeConnector(),
 *   }));
 *
 * `MemoryCacheConnector` in @opencms/core is the reference. TTL expiry is
 * deliberately NOT asserted here: backends enforce it on their own clocks
 * with their own minimums (KV rounds up to 60 seconds), so a portable suite
 * can only require that a TTL write stays readable immediately. The memory
 * connector's exact expiry semantics are covered in core's own tests, where
 * the clock is injectable.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CacheConnector } from "@opencms/core";

export interface CacheHarness {
  connector: CacheConnector;
  cleanup?: (connector: CacheConnector) => Promise<void>;
}

export type CacheHarnessFactory = () => Promise<CacheHarness>;

export function runCacheConnectorSuite(name: string, factory: CacheHarnessFactory): void {
  describe(`CacheConnector conformance: ${name}`, () => {
    let c: CacheConnector;
    let cleanup: ((c: CacheConnector) => Promise<void>) | undefined;

    beforeEach(async () => {
      const harness = await factory();
      c = harness.connector;
      cleanup = harness.cleanup;
    });

    afterEach(async () => {
      await cleanup?.(c);
    });

    test("a missing key reads as null", async () => {
      expect(await c.get("cache-suite/never-set")).toBeNull();
    });

    test("set then get round-trips, including unicode and JSON text", async () => {
      const value = JSON.stringify({ title: "Grüße 👋", n: 42 });
      await c.set("cache-suite/roundtrip", value);
      expect(await c.get("cache-suite/roundtrip")).toBe(value);
    });

    test("an empty string value is a value, not a miss", async () => {
      await c.set("cache-suite/empty", "");
      expect(await c.get("cache-suite/empty")).toBe("");
    });

    test("set overwrites in place", async () => {
      await c.set("cache-suite/over", "first");
      await c.set("cache-suite/over", "second");
      expect(await c.get("cache-suite/over")).toBe("second");
    });

    test("keys are independent, prefixes do not alias", async () => {
      await c.set("cache-suite/a", "1");
      await c.set("cache-suite/a/b", "2");
      expect(await c.get("cache-suite/a")).toBe("1");
      expect(await c.get("cache-suite/a/b")).toBe("2");
      expect(await c.get("cache-suite/a/")).toBeNull();
    });

    test("delete removes, deleting a missing key is a no-op", async () => {
      await c.set("cache-suite/gone", "x");
      await c.delete("cache-suite/gone");
      expect(await c.get("cache-suite/gone")).toBeNull();
      await c.delete("cache-suite/gone"); // second delete must not throw
    });

    test("a TTL write is readable immediately", async () => {
      await c.set("cache-suite/ttl", "fresh", { ttlSeconds: 120 });
      expect(await c.get("cache-suite/ttl")).toBe("fresh");
    });
  });
}
