import { test } from "bun:test";
import type { StorageConnector, StorageListedObject, StorageObjectInfo } from "@opencms/core";
import { runStorageConnectorSuite } from "@opencms/test-kit";
import { S3StorageConnector } from "@opencms/connector-s3";

/**
 * The same conformance suite against a real S3-compatible bucket.
 *
 * Skipped unless `OPENCMS_S3_LIVE=1` and credentials are present, so CI and a
 * plain `bun run test:all` stay offline and free. Run it when you want to know
 * that R2, MinIO or AWS really behaves the way the fake claims:
 *
 *   OPENCMS_S3_LIVE=1 \
 *   OPENCMS_S3_BUCKET=media \
 *   OPENCMS_S3_ACCOUNT_ID=<cloudflare account id> \
 *   OPENCMS_S3_ACCESS_KEY_ID=... \
 *   OPENCMS_S3_SECRET_ACCESS_KEY=... \
 *     bun test packages/connector-s3/test/live.test.ts
 *
 * Use a throwaway bucket. Every test writes under its own
 * `conformance/<run>/` prefix and deletes it afterwards, but a suite that
 * fails halfway can still leave objects behind.
 */

const env = (name: string) => process.env[`OPENCMS_S3_${name}`];
const enabled =
  env("LIVE") === "1" && !!env("BUCKET") && !!env("ACCESS_KEY_ID") && !!env("SECRET_ACCESS_KEY");

/**
 * Namespaces every key so a live run cannot collide with real media, or with
 * another run happening at the same time. Delegation is explicit rather than a
 * Proxy so the compiler still checks the connector surface.
 */
function prefixed(inner: StorageConnector, prefix: string): StorageConnector {
  const k = (key: string) => `${prefix}${key}`;
  const strip = (o: StorageListedObject) => ({ ...o, key: o.key.slice(prefix.length) });

  return {
    put: (key, body, opts) =>
      inner.put(k(key), body, opts).then((i: StorageObjectInfo) => ({ ...i, key })),
    get: (key) => inner.get(k(key)),
    head: (key) => inner.head(k(key)).then((i) => (i ? { ...i, key } : null)),
    delete: (key) => inner.delete(k(key)),
    // The cursor is opaque and passes straight through in both directions.
    // Prefixing or slicing it works against the in-memory connector, whose
    // cursor happens to be a key, and corrupts S3's continuation token, which
    // it then rejects with 400 InvalidArgument. Only keys get the prefix.
    list: (p, opts) =>
      inner.list(k(p), opts).then((r) => ({
        objects: r.objects.map(strip),
        ...(r.cursor ? { cursor: r.cursor } : {}),
      })),
    publicUrl: (key) => inner.publicUrl(k(key)),
  };
}

async function removeAll(connector: StorageConnector, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page: { objects: StorageListedObject[]; cursor?: string } = await connector.list(prefix, {
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    for (const o of page.objects) await connector.delete(o.key);
    cursor = page.cursor;
  } while (cursor);
}

if (!enabled) {
  test.skip("live S3 conformance (set OPENCMS_S3_LIVE=1 and credentials to run)", () => {});
} else {
  let run = 0;

  runStorageConnectorSuite("s3 (live bucket)", async () => {
    // Date.now plus a counter, so parallel runs on one machine still differ
    // and keys stay sortable by when they were written.
    const prefix = `conformance/${Date.now()}-${run++}/`;

    const endpoint = env("ENDPOINT");
    const accountId = env("ACCOUNT_ID");
    const base = new S3StorageConnector({
      bucket: env("BUCKET")!,
      accessKeyId: env("ACCESS_KEY_ID")!,
      secretAccessKey: env("SECRET_ACCESS_KEY")!,
      ...(endpoint ? { endpoint } : {}),
      ...(accountId ? { accountId } : {}),
      ...(env("REGION") ? { region: env("REGION")! } : {}),
      ...(env("PUBLIC_BASE_URL") ? { publicBaseUrl: env("PUBLIC_BASE_URL")! } : {}),
    });

    return {
      connector: prefixed(base, prefix),
      expectsPublicUrl: !!env("PUBLIC_BASE_URL"),
      cleanup: async () => {
        await removeAll(base, prefix);
      },
    };
  });
}
