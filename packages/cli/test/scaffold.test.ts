import { describe, expect, test } from "bun:test";
import { bunSqlite, cloudflare, cloudflareCdn, defineConfig, sameOrigin, s3, vercel } from "../src/config.ts";
import {
  generateSecret,
  patchWranglerToml,
  projectDirName,
  renderConfigTs,
  renderEnvFile,
} from "../src/scaffold.ts";

const config = defineConfig({
  projectName: "My Blog",
  adminEmail: "me@example.com",
  adminName: "Mehdi",
  backend: bunSqlite({ publicUrl: "http://localhost:3000", port: 3000, dbPath: "opencms.db" }),
});

describe("projectDirName", () => {
  test("slugifies the project name", () => {
    expect(projectDirName("My Blog")).toBe("my-blog");
    expect(projectDirName("blog")).toBe("blog");
    expect(projectDirName("  Édition 2026! ")).toBe("dition-2026");
  });

  test("falls back when nothing usable remains", () => {
    expect(projectDirName("!!!")).toBe("opencms-site");
  });
});

describe("renderConfigTs", () => {
  const rendered = renderConfigTs(config);

  test("is a typed module of defineConfig plus integrations", () => {
    expect(rendered).toContain(
      'import { defineConfig, bunSqlite } from "./packages/cli/src/config.ts";',
    );
    expect(rendered).toContain("export default defineConfig({");
    expect(rendered).toContain("backend: bunSqlite({");
    expect(rendered).not.toContain("InitConfig");
    expect(rendered).not.toContain('kind: "bun-sqlite"');
  });

  test("carries the choices with unquoted keys", () => {
    expect(rendered).toContain('projectName: "My Blog"');
    expect(rendered).toContain('publicUrl: "http://localhost:3000"');
    expect(rendered).not.toContain('"projectName":');
  });

  test("renders optional frontend and cache as their factories", () => {
    const full = renderConfigTs(
      defineConfig({
        ...config,
        frontend: vercel({
          url: "https://blog.example.com",
          extraOrigins: ["http://localhost:5173"],
          credentials: true,
        }),
        cache: cloudflareCdn({ ttlSeconds: 60 }),
      }),
    );
    expect(full).toContain(
      "import { defineConfig, bunSqlite, vercel, cloudflareCdn } from",
    );
    expect(full).toContain("frontend: vercel({");
    expect(full).toContain("cache: cloudflareCdn({");
    expect(full).toContain('url: "https://blog.example.com"');
    expect(full).toContain('extraOrigins: ["http://localhost:5173"]');
    expect(full).toContain("credentials: true");
    expect(full).toContain("ttlSeconds: 60");
    expect(full).not.toContain('host: "vercel"');
    expect(full).not.toContain('kind: "cloudflare-cdn"');
  });

  test("renders s3 storage without credentials", () => {
    const rendered = renderConfigTs(
      defineConfig({
        ...config,
        storage: s3({ bucket: "media", endpoint: "https://s3.example.com" }),
      }),
    );
    expect(rendered).toContain("s3({");
    expect(rendered).toContain('bucket: "media"');
    expect(rendered).not.toContain("ACCESS_KEY");
    expect(rendered).not.toContain('kind: "s3"');
  });

  test("same-origin frontend renders as a call with no args", () => {
    const rendered = renderConfigTs(defineConfig({ ...config, frontend: sameOrigin() }));
    expect(rendered).toContain("sameOrigin");
    expect(rendered).toContain("frontend: sameOrigin(),");
    expect(rendered).not.toContain("extraOrigins");
  });
});

describe("renderEnvFile", () => {
  test("local URL: db, port and secret, no BETTER_AUTH_URL", () => {
    const env = renderEnvFile(config.backend, "s3cret");
    expect(env).toContain("OPENCMS_DB=opencms.db");
    expect(env).toContain("OPENCMS_PORT=3000");
    expect(env).toContain("BETTER_AUTH_SECRET=s3cret");
    expect(env).not.toContain("BETTER_AUTH_URL");
  });

  test("public URL adds BETTER_AUTH_URL", () => {
    const env = renderEnvFile(
      bunSqlite({ publicUrl: "https://cms.example.com", port: 3000, dbPath: "x.db" }),
      "s3cret",
    );
    expect(env).toContain("BETTER_AUTH_URL=https://cms.example.com");
  });
});

describe("patchWranglerToml", () => {
  const toml = [
    'name = "opencms-api"',
    'main = "src/index.ts"',
    "[[d1_databases]]",
    'binding = "DB"',
    'database_name = "opencms"',
    'database_id = "REPLACE_WITH_YOUR_DATABASE_ID"',
  ].join("\n");

  test("applies worker and database names", () => {
    const patched = patchWranglerToml(toml, cloudflare({ workerName: "my-worker", d1Name: "my-db" }));
    expect(patched).toContain('name = "my-worker"');
    expect(patched).toContain('database_name = "my-db"');
    expect(patched).not.toContain('name = "opencms-api"');
    expect(patched).not.toContain("[vars]");
  });

  test("adds BETTER_AUTH_URL vars only with a custom domain", () => {
    const patched = patchWranglerToml(
      toml,
      cloudflare({ workerName: "my-worker", d1Name: "my-db", customDomain: "cms.example.com" }),
    );
    expect(patched).toContain("[vars]");
    expect(patched).toContain('BETTER_AUTH_URL = "https://cms.example.com"');
  });
});

describe("generateSecret", () => {
  test("returns distinct 32-byte base64 secrets", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).toHaveLength(44);
    expect(a).not.toBe(b);
  });
});
