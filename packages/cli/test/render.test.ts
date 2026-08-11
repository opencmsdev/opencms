import { describe, expect, test } from "bun:test";
import type { InitConfig } from "../src/config.ts";
import { renderAgentPrompt, summaryRows } from "../src/render.ts";

const selfHosted: InitConfig = {
  projectName: "blog",
  adminEmail: "me@example.com",
  adminName: "Mehdi",
  backend: { kind: "bun-sqlite", publicUrl: "http://localhost:3000", port: 3000, dbPath: "opencms.db" },
};

const edge: InitConfig = {
  projectName: "edge-site",
  adminEmail: "me@example.com",
  adminName: "Mehdi",
  backend: { kind: "cloudflare", workerName: "opencms-api", d1Name: "opencms", customDomain: "cms.example.com" },
  frontend: {
    host: "vercel",
    url: "https://site.example.com",
    extraOrigins: ["http://localhost:5173"],
    credentials: true,
  },
  cache: { kind: "cloudflare-cdn", ttlSeconds: 120 },
};

describe("renderAgentPrompt, self-hosted profile", () => {
  const prompt = renderAgentPrompt(selfHosted);

  test("uses the Bun profile commands and never wrangler", () => {
    expect(prompt).toContain("bun run build:admin");
    expect(prompt).toContain("bun run dev");
    expect(prompt).toContain("export OPENCMS_PORT=3000");
    expect(prompt).toContain('export OPENCMS_DB="opencms.db"');
    expect(prompt).not.toContain("wrangler");
  });

  test("tells the agent to generate secrets instead of embedding them", () => {
    expect(prompt).toContain("openssl rand -base64 32");
    expect(prompt).toContain("<GENERATED-PASSWORD>");
  });

  test("keeps default CORS when no frontend is configured", () => {
    expect(prompt).not.toContain("createApp({");
    expect(prompt).toContain("Access-Control-Allow-Origin: *");
  });

  test("no cache section when cache was skipped", () => {
    expect(prompt).not.toContain("CDN cache");
  });

  test("verifies against the configured URL with the admin email", () => {
    expect(prompt).toContain("API=http://localhost:3000");
    expect(prompt).toContain('"email":"me@example.com"');
    expect(prompt).toContain("## Acceptance checklist");
  });

  test("localhost needs no reverse proxy step", () => {
    expect(prompt).not.toContain("reverse");
  });
});

describe("renderAgentPrompt, cloudflare profile with frontend and cache", () => {
  const prompt = renderAgentPrompt(edge);

  test("uses the Workers profile commands", () => {
    expect(prompt).toContain("bunx wrangler d1 create opencms");
    expect(prompt).toContain('name = "opencms-api"');
    expect(prompt).toContain("bunx wrangler deploy");
    expect(prompt).toContain('BETTER_AUTH_URL = "https://cms.example.com"');
  });

  test("configures CORS for the frontend origins with credentials", () => {
    expect(prompt).toContain("apps/worker/src/index.ts");
    expect(prompt).toContain('origin: ["https://site.example.com", "http://localhost:5173"]');
    expect(prompt).toContain("credentials: true");
    expect(prompt).toContain("trustedOrigins");
  });

  test("cache section caches anonymous content reads only", () => {
    expect(prompt).toContain("120 seconds");
    expect(prompt).toContain("GET /api/content/*");
    expect(prompt).toContain("Never cache `/api/auth/*`");
    expect(prompt).toContain("Cache Rule");
  });

  test("verifies against the custom domain", () => {
    expect(prompt).toContain("API=https://cms.example.com");
  });
});

describe("renderAgentPrompt, edge cases", () => {
  test("workers.dev placeholder is spelled out when no custom domain", () => {
    const prompt = renderAgentPrompt({
      ...edge,
      backend: { kind: "cloudflare", workerName: "opencms-api", d1Name: "opencms" },
    });
    expect(prompt).toContain("https://opencms-api.YOUR-SUBDOMAIN.workers.dev");
    expect(prompt).toContain("substitute that real URL");
  });

  test("non-localhost self-hosted URL adds the reverse proxy step", () => {
    const prompt = renderAgentPrompt({
      ...selfHosted,
      backend: { kind: "bun-sqlite", publicUrl: "https://cms.example.com", port: 3000, dbPath: "opencms.db" },
    });
    expect(prompt).toContain("reverse");
    expect(prompt).toContain('export BETTER_AUTH_URL="https://cms.example.com"');
  });

  test("same-origin frontend needs no CORS changes", () => {
    const prompt = renderAgentPrompt({
      ...selfHosted,
      frontend: { host: "same-origin", extraOrigins: [], credentials: false },
    });
    expect(prompt).toContain("shares the API origin");
    expect(prompt).not.toContain("createApp({");
  });

  test("steps are numbered sequentially from 1", () => {
    const prompt = renderAgentPrompt(edge);
    const steps = [...prompt.matchAll(/### Step (\d+):/g)].map((m) => Number(m[1]));
    expect(steps[0]).toBe(1);
    expect(steps).toEqual(steps.map((_, i) => i + 1));
  });

  test("no em or en dashes anywhere in the output", () => {
    for (const config of [selfHosted, edge]) {
      const prompt = renderAgentPrompt(config);
      expect(prompt).not.toContain("—");
      expect(prompt).not.toContain("–");
    }
  });
});

describe("summaryRows", () => {
  test("no frontend reads as API only", () => {
    const rows = summaryRows(selfHosted);
    expect(rows.find((r) => r.label === "Frontend host")?.value).toBe("None (API only)");
    expect(rows.find((r) => r.label === "Cache")?.value).toBe("None");
    expect(rows.find((r) => r.label === "Admin account")?.value).toBe("Mehdi <me@example.com>");
  });

  test("frontend and cache choices show their data", () => {
    const rows = summaryRows(edge);
    expect(rows.find((r) => r.label === "Frontend host")?.value).toBe("Vercel (https://site.example.com)");
    expect(rows.find((r) => r.label === "Allowed origins")?.value).toBe(
      "https://site.example.com, http://localhost:5173",
    );
    expect(rows.find((r) => r.label === "Cache")?.value).toBe("Cloudflare CDN, TTL 120s");
  });
});
