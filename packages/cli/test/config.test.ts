import { describe, expect, test } from "bun:test";
import {
  apiBaseUrl,
  assertInitConfig,
  bunSqlite,
  cloudflare,
  cloudflareCdn,
  corsOrigins,
  defineConfig,
  parseOriginList,
  sameOrigin,
  s3,
  r2,
  validateBucket,
  validateCloudflareName,
  validateDomain,
  validateEmail,
  validateOriginList,
  validatePort,
  validateTtl,
  validateUrl,
  vercel,
} from "../src/config.ts";

describe("validators", () => {
  test("validateUrl accepts http(s) URLs and rejects everything else", () => {
    expect(validateUrl("https://example.com")).toBeUndefined();
    expect(validateUrl("http://localhost:3000")).toBeUndefined();
    expect(validateUrl("example.com")).toBeDefined();
    expect(validateUrl("ftp://example.com")).toBeDefined();
    expect(validateUrl("not a url")).toBeDefined();
  });

  test("validateEmail", () => {
    expect(validateEmail("me@example.com")).toBeUndefined();
    expect(validateEmail("me@example")).toBeDefined();
    expect(validateEmail("nope")).toBeDefined();
  });

  test("validatePort", () => {
    expect(validatePort("3000")).toBeUndefined();
    expect(validatePort("1")).toBeUndefined();
    expect(validatePort("65535")).toBeUndefined();
    expect(validatePort("0")).toBeDefined();
    expect(validatePort("65536")).toBeDefined();
    expect(validatePort("30.5")).toBeDefined();
    expect(validatePort("abc")).toBeDefined();
  });

  test("validateTtl", () => {
    expect(validateTtl("60")).toBeUndefined();
    expect(validateTtl("0")).toBeDefined();
    expect(validateTtl("-5")).toBeDefined();
  });

  test("validateBucket", () => {
    expect(validateBucket("media")).toBeUndefined();
    expect(validateBucket("opencms-media")).toBeUndefined();
    expect(validateBucket("ab")).toBeDefined();
    expect(validateBucket("Media")).toBeDefined();
  });

  test("validateCloudflareName", () => {
    expect(validateCloudflareName("opencms-api")).toBeUndefined();
    expect(validateCloudflareName("a")).toBeUndefined();
    expect(validateCloudflareName("My-Worker")).toBeDefined();
    expect(validateCloudflareName("-edge")).toBeDefined();
    expect(validateCloudflareName("edge-")).toBeDefined();
    expect(validateCloudflareName("a".repeat(64))).toBeDefined();
  });

  test("validateDomain wants a bare hostname", () => {
    expect(validateDomain("cms.example.com")).toBeUndefined();
    expect(validateDomain("example.co.uk")).toBeUndefined();
    expect(validateDomain("https://cms.example.com")).toBeDefined();
    expect(validateDomain("localhost")).toBeDefined();
    expect(validateDomain("cms.example.com/path")).toBeDefined();
  });

  test("validateOriginList checks each comma-separated entry", () => {
    expect(validateOriginList("https://a.com, http://localhost:5173")).toBeUndefined();
    expect(validateOriginList("")).toBeUndefined();
    expect(validateOriginList("https://a.com, nope")).toBeDefined();
  });
});

describe("origin helpers", () => {
  test("parseOriginList normalizes to origins and dedupes", () => {
    expect(parseOriginList("https://a.com/some/path, http://localhost:5173, https://a.com")).toEqual([
      "https://a.com",
      "http://localhost:5173",
    ]);
    expect(parseOriginList("")).toEqual([]);
  });

  test("corsOrigins merges the frontend URL with extras", () => {
    const config = defineConfig({
      projectName: "p",
      adminEmail: "a@b.co",
      adminName: "A",
      backend: bunSqlite({ publicUrl: "http://localhost:3000", port: 3000, dbPath: "x.db" }),
      frontend: vercel({
        url: "https://site.example.com/landing",
        extraOrigins: ["http://localhost:5173", "https://site.example.com"],
        credentials: true,
      }),
    });
    expect(corsOrigins(config)).toEqual(["https://site.example.com", "http://localhost:5173"]);
  });

  test("corsOrigins is empty for no frontend and for same-origin", () => {
    const base = defineConfig({
      projectName: "p",
      adminEmail: "a@b.co",
      adminName: "A",
      backend: bunSqlite({ publicUrl: "http://localhost:3000", port: 3000, dbPath: "x.db" }),
    });
    expect(corsOrigins(base)).toEqual([]);
    expect(corsOrigins({ ...base, frontend: sameOrigin() })).toEqual([]);
  });
});

describe("apiBaseUrl", () => {
  test("self-hosted uses the public URL without a trailing slash", () => {
    expect(
      apiBaseUrl(bunSqlite({ publicUrl: "https://cms.example.com/", port: 443, dbPath: "x.db" })),
    ).toBe("https://cms.example.com");
  });

  test("cloudflare prefers the custom domain, else a spelled-out placeholder", () => {
    expect(
      apiBaseUrl(cloudflare({ workerName: "opencms-api", d1Name: "opencms", customDomain: "cms.example.com" })),
    ).toBe("https://cms.example.com");
    expect(apiBaseUrl(cloudflare({ workerName: "opencms-api", d1Name: "opencms" }))).toBe(
      "https://opencms-api.YOUR-SUBDOMAIN.workers.dev",
    );
  });
});

describe("integrations", () => {
  test("factories tag the object; callers never pass the discriminator", () => {
    expect(bunSqlite({ publicUrl: "http://localhost:3000", port: 3000, dbPath: "x.db" }).kind).toBe(
      "bun-sqlite",
    );
    expect(cloudflare({ workerName: "w", d1Name: "d" }).kind).toBe("cloudflare");
    expect(vercel({ url: "https://a.com" })).toEqual({
      host: "vercel",
      url: "https://a.com",
      extraOrigins: [],
      credentials: false,
    });
    expect(sameOrigin()).toEqual({ host: "same-origin", extraOrigins: [], credentials: false });
    expect(cloudflareCdn({ ttlSeconds: 60 })).toMatchObject({ kind: "cloudflare-cdn", ttlSeconds: 60 });
    expect(typeof bunSqlite({ publicUrl: "http://localhost:3000", port: 3000, dbPath: "x.db" }).setup).toBe(
      "function",
    );
    expect(typeof bunSqlite({ publicUrl: "http://localhost:3000", port: 3000, dbPath: "x.db" }).test).toBe(
      "function",
    );
    expect(typeof s3({ bucket: "media" }).setup).toBe("function");
    expect(typeof s3({ bucket: "media" }).test).toBe("function");
    expect(typeof r2({ bucket: "opencms-media" }).test).toBe("function");
  });

  test("defineConfig is an identity", () => {
    const config = {
      projectName: "p",
      adminEmail: "a@b.co",
      adminName: "A",
      backend: bunSqlite({ publicUrl: "http://localhost:3000", port: 3000, dbPath: "x.db" }),
    };
    expect(defineConfig(config)).toBe(config);
  });

  test("assertInitConfig rejects junk", () => {
    expect(() => assertInitConfig(null)).toThrow("defineConfig");
    expect(() => assertInitConfig({ projectName: "p" })).toThrow("adminEmail");
    expect(
      assertInitConfig({
        projectName: "p",
        adminEmail: "a@b.co",
        adminName: "A",
        backend: bunSqlite({ publicUrl: "http://localhost:3000", port: 3000, dbPath: "x.db" }),
      }).projectName,
    ).toBe("p");
  });
});
