import { describe, expect, test } from "bun:test";
import { objectStoreEndpoint, probeObjectStore } from "../src/s3-probe.ts";

describe("objectStoreEndpoint", () => {
  test("prefers an explicit endpoint", () => {
    expect(
      objectStoreEndpoint({
        OPENCMS_S3_ENDPOINT: "https://s3.example.com/",
        OPENCMS_S3_ACCOUNT_ID: "abc",
      }),
    ).toBe("https://s3.example.com");
  });

  test("derives R2 from the account id", () => {
    expect(objectStoreEndpoint({ OPENCMS_S3_ACCOUNT_ID: "abcdef0123456789abcdef0123456789" })).toBe(
      "https://abcdef0123456789abcdef0123456789.r2.cloudflarestorage.com",
    );
  });

  test("AWS region fallback, otherwise undefined", () => {
    expect(objectStoreEndpoint({ OPENCMS_S3_REGION: "eu-west-1" })).toBe(
      "https://s3.eu-west-1.amazonaws.com",
    );
    expect(objectStoreEndpoint({ OPENCMS_S3_REGION: "auto" })).toBeUndefined();
    expect(objectStoreEndpoint({})).toBeUndefined();
  });
});

describe("probeObjectStore", () => {
  test("signs a ListObjectsV2 GET against the bucket", async () => {
    let url = "";
    await probeObjectStore({
      bucket: "media",
      endpoint: "https://s3.example.com",
      region: "auto",
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret",
      fetch: async (input) => {
        url = String(input instanceof Request ? input.url : input);
        return new Response("<ListBucketResult/>", { status: 200 });
      },
    });
    expect(url).toContain("https://s3.example.com/media");
    expect(url).toContain("list-type=2");
  });

  test("403 with an S3 error code becomes a readable failure", async () => {
    await expect(
      probeObjectStore({
        bucket: "media",
        endpoint: "https://s3.example.com",
        accessKeyId: "AKIATEST",
        secretAccessKey: "nope",
        fetch: async () =>
          new Response("<Error><Code>InvalidAccessKeyId</Code></Error>", { status: 403 }),
      }),
    ).rejects.toThrow("403 InvalidAccessKeyId");
  });
});
