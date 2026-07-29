import { createS3Fake, runStorageConnectorSuite } from "@opencms/test-kit";
import { S3StorageConnector } from "@opencms/connector-s3";

/**
 * The S3 connector against an in-process S3, so this runs anywhere with no
 * credentials. It exercises the real request building, signing, path encoding
 * and XML parsing; only the network is fake.
 *
 * `test/live.test.ts` runs the same suite against a real bucket when asked.
 */

function harness(publicBaseUrl?: string) {
  const fake = createS3Fake({ bucket: "media" });
  return {
    connector: new S3StorageConnector({
      bucket: "media",
      accountId: "test-account",
      accessKeyId: "AKIAFAKEFAKEFAKE",
      secretAccessKey: "secret-not-used-by-the-fake",
      fetch: fake.fetch,
      ...(publicBaseUrl ? { publicBaseUrl } : {}),
    }),
  };
}

runStorageConnectorSuite("s3 (fake backend)", async () => harness());

runStorageConnectorSuite("s3 (fake backend, public base URL)", async () => ({
  ...harness("https://media.opencms.dev"),
  expectsPublicUrl: true,
}));
