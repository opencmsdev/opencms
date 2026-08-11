import { describe, expect, test } from "bun:test";
import type { InitConfig } from "../src/config.ts";
import {
  generateSecret,
  patchWranglerToml,
  projectDirName,
  renderConfigTs,
  renderEnvFile,
} from "../src/scaffold.ts";

const config: InitConfig = {
  projectName: "My Blog",
  adminEmail: "me@example.com",
  adminName: "Mehdi",
  backend: { kind: "bun-sqlite", publicUrl: "http://localhost:3000", port: 3000, dbPath: "opencms.db" },
};

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

  test("is a typed module importing InitConfig from the monorepo", () => {
    expect(rendered).toContain('import type { InitConfig } from "./packages/cli/src/config.ts";');
    expect(rendered).toContain("const config: InitConfig = {");
    expect(rendered).toContain("export default config;");
  });

  test("carries the choices with unquoted keys", () => {
    expect(rendered).toContain('projectName: "My Blog"');
    expect(rendered).toContain('kind: "bun-sqlite"');
    expect(rendered).not.toContain('"projectName":');
  });
});

describe("renderEnvFile", () => {
  test("local URL: db, port and secret, no BETTER_AUTH_URL", () => {
    const env = renderEnvFile(config.backend as never, "s3cret");
    expect(env).toContain("OPENCMS_DB=opencms.db");
    expect(env).toContain("OPENCMS_PORT=3000");
    expect(env).toContain("BETTER_AUTH_SECRET=s3cret");
    expect(env).not.toContain("BETTER_AUTH_URL");
  });

  test("public URL adds BETTER_AUTH_URL", () => {
    const env = renderEnvFile(
      { kind: "bun-sqlite", publicUrl: "https://cms.example.com", port: 3000, dbPath: "x.db" },
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
    const patched = patchWranglerToml(toml, {
      kind: "cloudflare",
      workerName: "my-worker",
      d1Name: "my-db",
    });
    expect(patched).toContain('name = "my-worker"');
    expect(patched).toContain('database_name = "my-db"');
    expect(patched).not.toContain('name = "opencms-api"');
    expect(patched).not.toContain("[vars]");
  });

  test("adds BETTER_AUTH_URL vars only with a custom domain", () => {
    const patched = patchWranglerToml(toml, {
      kind: "cloudflare",
      workerName: "my-worker",
      d1Name: "my-db",
      customDomain: "cms.example.com",
    });
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
