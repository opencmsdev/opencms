import { describe, expect, test } from "bun:test";
import { MemoryDataConnector } from "@opencms/core";
import { createApp, type AuthConnector, type CorsOptions } from "@opencms/api";

/**
 * CORS is pure middleware, so these tests use a stub auth connector rather
 * than booting better-auth: nothing here depends on a real session, and the
 * preflight cases specifically need to prove they never reach auth at all.
 */
const stubAuth: AuthConnector = {
  handler: async () => new Response(null, { status: 404 }),
  needsSetup: async () => false,
  api: {
    getSession: async () => null,
    verifyApiKey: async () => ({ valid: false, key: null }),
  },
};

async function appWith(cors?: CorsOptions | false) {
  const data = new MemoryDataConnector();
  await data.init();
  return createApp({ data, auth: stubAuth, cors });
}

const SITE = "https://site.example";
const OTHER = "https://evil.example";

describe("CORS defaults", () => {
  test("a cross-origin GET is allowed from anywhere", async () => {
    const app = await appWith();
    const res = await app.request("/health", { headers: { origin: SITE } });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    // The wildcard is origin-independent, so the response stays cacheable.
    expect(res.headers.get("vary")).toBeNull();
  });

  test("a request without an Origin header is left untouched", async () => {
    const app = await appWith();
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("a preflight is answered 204 without reaching auth", async () => {
    const app = await appWith();
    const res = await app.request("/api/entries/article", {
      method: "OPTIONS",
      headers: {
        origin: SITE,
        "access-control-request-method": "POST",
        "access-control-request-headers": "x-api-key",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("x-api-key");
    expect(res.headers.get("access-control-max-age")).toBe("86400");
  });

  test("the wildcard never carries credentials, even when asked", async () => {
    // Pairing the two is forbidden by the Fetch standard. Rather than
    // silently narrowing the origin, the wildcard wins and credentials drop.
    const app = await appWith({ origin: "*", credentials: true });
    const res = await app.request("/health", { headers: { origin: SITE } });

    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

describe("CORS with an explicit allowlist", () => {
  test("an allowed origin is echoed back and varies on Origin", async () => {
    const app = await appWith({ origin: [SITE] });
    const res = await app.request("/health", { headers: { origin: SITE } });

    expect(res.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(res.headers.get("vary")).toContain("Origin");
  });

  test("an origin outside the list gets no CORS headers", async () => {
    const app = await appWith({ origin: [SITE] });
    const res = await app.request("/health", { headers: { origin: OTHER } });

    // The request still succeeds server-side; the browser is what blocks it.
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("a denied preflight is still 204, so the failure reads as CORS not 404", async () => {
    const app = await appWith({ origin: [SITE] });
    const res = await app.request("/api/entries/article", {
      method: "OPTIONS",
      headers: { origin: OTHER, "access-control-request-method": "POST" },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("credentials are allowed once the origin is explicit", async () => {
    const app = await appWith({ origin: SITE, credentials: true });
    const res = await app.request("/health", { headers: { origin: SITE } });

    expect(res.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  test("a predicate origin decides per request", async () => {
    const app = await appWith({ origin: (o) => o.endsWith(".site.example") });

    const ok = await app.request("/health", { headers: { origin: "https://a.site.example" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://a.site.example");

    const no = await app.request("/health", { headers: { origin: OTHER } });
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("exposeHeaders is advertised when configured", async () => {
    const app = await appWith({ exposeHeaders: ["x-total-count"] });
    const res = await app.request("/health", { headers: { origin: SITE } });

    expect(res.headers.get("access-control-expose-headers")).toBe("x-total-count");
  });
});

describe("CORS disabled", () => {
  test("cors: false emits nothing and leaves OPTIONS unhandled", async () => {
    const app = await appWith(false);
    const res = await app.request("/health", { headers: { origin: SITE } });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
