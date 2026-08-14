import { describe, expect, test } from "bun:test";
import {
  isPlaceholderDatabaseId,
  readDatabaseId,
  setDatabaseId,
  setDatabaseName,
  setWorkerName,
  upsertCustomDomain,
  upsertVars,
} from "../src/toml.ts";

const shipped = [
  'name = "opencms-api"',
  'main = "src/index.ts"',
  "# [vars]",
  '# BETTER_AUTH_URL = "https://example.workers.dev"',
  "[[d1_databases]]",
  'binding = "DB"',
  'database_name = "opencms"',
  'database_id = "REPLACE_WITH_YOUR_DATABASE_ID"',
  "",
].join("\n");

describe("database_id", () => {
  test("placeholder detection", () => {
    expect(isPlaceholderDatabaseId("REPLACE_WITH_YOUR_DATABASE_ID")).toBe(true);
    expect(isPlaceholderDatabaseId("abc")).toBe(false);
  });

  test("read and replace", () => {
    expect(readDatabaseId(shipped)).toBe("REPLACE_WITH_YOUR_DATABASE_ID");
    const next = setDatabaseId(shipped, "11111111-1111-1111-1111-111111111111");
    expect(readDatabaseId(next)).toBe("11111111-1111-1111-1111-111111111111");
  });
});

describe("names", () => {
  test("worker and D1 names", () => {
    const next = setDatabaseName(setWorkerName(shipped, "my-api"), "my-db");
    expect(next).toContain('name = "my-api"');
    expect(next).toContain('database_name = "my-db"');
  });
});

describe("upsertVars", () => {
  test("appends a real [vars] and ignores the commented one", () => {
    const next = upsertVars(shipped, { BETTER_AUTH_URL: "https://cms.example.com" });
    expect(next).toContain("[vars]");
    expect(next).toContain('BETTER_AUTH_URL = "https://cms.example.com"');
    expect(next).toContain("# [vars]");
  });

  test("updates an existing uncommented var", () => {
    const withVars = shipped + '\n[vars]\nBETTER_AUTH_URL = "https://old.example"\n';
    const next = upsertVars(withVars, { BETTER_AUTH_URL: "https://new.example", OPENCMS_S3_BUCKET: "media" });
    expect(next).toContain('BETTER_AUTH_URL = "https://new.example"');
    expect(next).not.toContain("https://old.example");
    expect(next).toContain('OPENCMS_S3_BUCKET = "media"');
    expect(next.match(/^\[vars\]/gm)?.length).toBe(1);
  });
});

describe("upsertCustomDomain", () => {
  test("adds a route once", () => {
    const once = upsertCustomDomain(shipped, "cms.example.com");
    const twice = upsertCustomDomain(once, "cms.example.com");
    expect(once).toContain('pattern = "cms.example.com"');
    expect(once).toContain("custom_domain = true");
    expect(twice).toBe(once);
  });
});
