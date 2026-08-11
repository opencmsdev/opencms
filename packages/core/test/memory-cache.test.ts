import { describe, expect, test } from "bun:test";
import { MemoryCacheConnector } from "../src";

/**
 * Exact expiry semantics, testable here because the clock is injectable.
 * The conformance run against the reference lives in @opencms/test-kit's own
 * tests, beside the data and storage references.
 */
describe("MemoryCacheConnector TTL", () => {
  test("a value expires exactly at its deadline, lazily", async () => {
    let now = new Date("2026-08-11T10:00:00Z");
    const cache = new MemoryCacheConnector(() => now);

    await cache.set("k", "v", { ttlSeconds: 60 });
    now = new Date("2026-08-11T10:00:59.999Z");
    expect(await cache.get("k")).toBe("v");

    now = new Date("2026-08-11T10:01:00Z");
    expect(await cache.get("k")).toBeNull();
  });

  test("no TTL means no expiry", async () => {
    let now = new Date("2026-08-11T10:00:00Z");
    const cache = new MemoryCacheConnector(() => now);
    await cache.set("k", "v");
    now = new Date("2027-01-01T00:00:00Z");
    expect(await cache.get("k")).toBe("v");
  });

  test("overwriting refreshes the deadline", async () => {
    let now = new Date("2026-08-11T10:00:00Z");
    const cache = new MemoryCacheConnector(() => now);
    await cache.set("k", "v1", { ttlSeconds: 60 });
    now = new Date("2026-08-11T10:00:30Z");
    await cache.set("k", "v2", { ttlSeconds: 60 });
    now = new Date("2026-08-11T10:01:15Z"); // past the first deadline only
    expect(await cache.get("k")).toBe("v2");
  });
});
