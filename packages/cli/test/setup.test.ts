import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { bunSqlite, cloudflare, r2, s3 } from "../src/config.ts";
import { parseEnv } from "../src/env-file.ts";
import { runSetup } from "../src/setup.ts";
import { readDatabaseId } from "../src/toml.ts";
import type { CommandResult, Run } from "../src/wrangler.ts";
import { FakeIO } from "./fake-io.ts";

const D1_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const WRANGLE = [
  'name = "opencms-api"',
  "[[d1_databases]]",
  'binding = "DB"',
  'database_name = "opencms"',
  'database_id = "REPLACE_WITH_YOUR_DATABASE_ID"',
  "",
].join("\n");

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "opencms-setup-"));
  mkdirSync(join(dir, "apps", "worker"), { recursive: true });
  writeFileSync(join(dir, "apps", "worker", "wrangler.toml"), WRANGLE);
  return dir;
}

function runScript(handlers: Array<{ match: RegExp | string; result: CommandResult }>): Run {
  return (cmd, args) => {
    const line = [cmd, ...args].join(" ");
    for (const handler of handlers) {
      const ok =
        typeof handler.match === "string" ? line.includes(handler.match) : handler.match.test(line);
      if (ok) return handler.result;
    }
    throw new Error(`unexpected command: ${line}`);
  };
}

const loggedIn = runScript([
  { match: "whoami", result: { status: 0, stdout: "You are logged in\nAccount abcdef0123456789abcdef0123456789\n", stderr: "" } },
  {
    match: "d1 list",
    result: {
      status: 0,
      stdout: JSON.stringify([{ name: "opencms", uuid: D1_ID }]),
      stderr: "",
    },
  },
  { match: "secret put", result: { status: 0, stdout: "", stderr: "" } },
  { match: "r2 bucket create", result: { status: 0, stdout: "Created bucket\n", stderr: "" } },
  { match: "d1 execute", result: { status: 0, stdout: `{"results":[{"1":1}]}`, stderr: "" } },
]);

function listOkFetch(): (input: Request | string | URL, init?: RequestInit) => Promise<Response> {
  return async () =>
    new Response(
      '<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>',
      { status: 200 },
    );
}

describe("runSetup, bun-sqlite", () => {
  test("writes .env and keeps the secret on a second run", async () => {
    const cwd = tempProject();
    const config = {
      projectName: "blog",
      adminEmail: "a@b.co",
      adminName: "A",
      backend: bunSqlite({ publicUrl: "http://localhost:3000", port: 3000, dbPath: "opencms.db" }),
    };
    const first = await runSetup(config, {
      cwd,
      io: new FakeIO([""]),
      run: loggedIn,
      generateSecret: () => "first-secret",
    });
    expect(first.ok).toBe(true);
    const env = parseEnv(readFileSync(join(cwd, ".env"), "utf8"));
    expect(env.BETTER_AUTH_SECRET).toBe("first-secret");
    expect(env.OPENCMS_DB).toBe("opencms.db");

    await runSetup(config, {
      cwd,
      io: new FakeIO([""]),
      run: loggedIn,
      generateSecret: () => "second-secret",
    });
    expect(parseEnv(readFileSync(join(cwd, ".env"), "utf8")).BETTER_AUTH_SECRET).toBe("first-secret");
  });

  test("S3 asks for keys and stores them in .env", async () => {
    const cwd = tempProject();
    const result = await runSetup(
      {
        projectName: "blog",
        adminEmail: "a@b.co",
        adminName: "A",
        backend: bunSqlite({ publicUrl: "http://localhost:3000", port: 3000, dbPath: "x.db" }),
        storage: s3({ bucket: "media", endpoint: "https://s3.example.com", region: "auto" }),
      },
      {
        cwd,
        io: new FakeIO(["", "AKIATEST", "secret-s3"]),
        run: loggedIn,
        generateSecret: () => "auth-secret",
        fetch: listOkFetch(),
      },
    );
    expect(result.ok).toBe(true);
    const env = parseEnv(readFileSync(join(cwd, ".env"), "utf8"));
    expect(env.OPENCMS_S3_BUCKET).toBe("media");
    expect(env.OPENCMS_S3_ENDPOINT).toBe("https://s3.example.com");
    expect(env.OPENCMS_S3_ACCESS_KEY_ID).toBe("AKIATEST");
    expect(env.OPENCMS_S3_SECRET_ACCESS_KEY).toBe("secret-s3");
  });
});

describe("runSetup, cloudflare", () => {
  test("fills database_id from an existing D1 and writes .dev.vars", async () => {
    const cwd = tempProject();
    const result = await runSetup(
      {
        projectName: "edge",
        adminEmail: "a@b.co",
        adminName: "A",
        backend: cloudflare({ workerName: "my-api", d1Name: "opencms", customDomain: "cms.example.com" }),
      },
      {
        cwd,
        io: new FakeIO([""]),
        run: loggedIn,
        generateSecret: () => "cf-secret",
      },
    );
    expect(result.ok).toBe(true);
    const toml = readFileSync(join(cwd, "apps", "worker", "wrangler.toml"), "utf8");
    expect(readDatabaseId(toml)).toBe(D1_ID);
    expect(toml).toContain('name = "my-api"');
    expect(toml).toContain('pattern = "cms.example.com"');
    expect(toml).toContain('BETTER_AUTH_URL = "https://cms.example.com"');
    const dev = parseEnv(readFileSync(join(cwd, "apps", "worker", ".dev.vars"), "utf8"));
    expect(dev.BETTER_AUTH_SECRET).toBe("cf-secret");
  });

  test("creates D1 when the list is empty", async () => {
    const cwd = tempProject();
    const run = runScript([
      { match: "whoami", result: { status: 0, stdout: "You are logged in", stderr: "" } },
      { match: "d1 list", result: { status: 0, stdout: "[]", stderr: "" } },
      {
        match: "d1 create",
        result: {
          status: 0,
          stdout: `database_id = "${D1_ID}"\n`,
          stderr: "",
        },
      },
      { match: "secret put", result: { status: 0, stdout: "", stderr: "" } },
      { match: "d1 execute", result: { status: 0, stdout: `{"results":[{"1":1}]}`, stderr: "" } },
    ]);
    const result = await runSetup(
      {
        projectName: "edge",
        adminEmail: "a@b.co",
        adminName: "A",
        backend: cloudflare({ workerName: "opencms-api", d1Name: "opencms" }),
      },
      { cwd, io: new FakeIO([""]), run, generateSecret: () => "s" },
    );
    expect(result.ok).toBe(true);
    expect(readDatabaseId(readFileSync(join(cwd, "apps", "worker", "wrangler.toml"), "utf8"))).toBe(
      D1_ID,
    );
  });

  test("R2 create plus keys stored as wrangler secrets", async () => {
    const cwd = tempProject();
    const puts: string[] = [];
    const run = runScript([
      { match: "whoami", result: { status: 0, stdout: "You are logged in\nabcdef0123456789abcdef0123456789\n", stderr: "" } },
      {
        match: "d1 list",
        result: { status: 0, stdout: JSON.stringify([{ name: "opencms", uuid: D1_ID }]), stderr: "" },
      },
      { match: "r2 bucket create", result: { status: 0, stdout: "ok", stderr: "" } },
      { match: "d1 execute", result: { status: 0, stdout: `{"results":[{"1":1}]}`, stderr: "" } },
      {
        match: /secret put/,
        result: { status: 0, stdout: "", stderr: "" },
      },
    ]);
    const wrapped: Run = (cmd, args, opts) => {
      if (args.includes("secret") && args.includes("put")) puts.push(args[args.length - 1]!);
      return run(cmd, args, opts);
    };
    const result = await runSetup(
      {
        projectName: "edge",
        adminEmail: "a@b.co",
        adminName: "A",
        backend: cloudflare({ workerName: "opencms-api", d1Name: "opencms" }),
        storage: r2({ bucket: "opencms-media" }),
      },
      {
        cwd,
        io: new FakeIO(["", "r2key", "r2secret"]),
        run: wrapped,
        generateSecret: () => "s",
        fetch: listOkFetch(),
      },
    );
    expect(result.ok).toBe(true);
    expect(puts).toContain("BETTER_AUTH_SECRET");
    expect(puts).toContain("OPENCMS_S3_ACCESS_KEY_ID");
    expect(puts).toContain("OPENCMS_S3_SECRET_ACCESS_KEY");
    const toml = readFileSync(join(cwd, "apps", "worker", "wrangler.toml"), "utf8");
    expect(toml).toContain('OPENCMS_S3_BUCKET = "opencms-media"');
    const dev = parseEnv(readFileSync(join(cwd, "apps", "worker", ".dev.vars"), "utf8"));
    expect(dev.OPENCMS_S3_ACCESS_KEY_ID).toBe("r2key");
  });

  test("--yes without S3 keys fails", async () => {
    const cwd = tempProject();
    const result = await runSetup(
      {
        projectName: "blog",
        adminEmail: "a@b.co",
        adminName: "A",
        backend: bunSqlite({ publicUrl: "http://localhost:3000", port: 3000, dbPath: "x.db" }),
        storage: s3({ bucket: "media" }),
      },
      {
        cwd,
        io: new FakeIO([]),
        run: loggedIn,
        yes: true,
        generateSecret: () => "s",
      },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("required");
  });

  test("S3 ListObjects failure fails setup", async () => {
    const cwd = tempProject();
    const result = await runSetup(
      {
        projectName: "blog",
        adminEmail: "a@b.co",
        adminName: "A",
        backend: bunSqlite({ publicUrl: "http://localhost:3000", port: 3000, dbPath: "x.db" }),
        storage: s3({ bucket: "media", endpoint: "https://s3.example.com" }),
      },
      {
        cwd,
        io: new FakeIO(["", "AKIATEST", "secret-s3"]),
        run: loggedIn,
        generateSecret: () => "s",
        fetch: async () =>
          new Response("<Error><Code>InvalidAccessKeyId</Code></Error>", { status: 403 }),
      },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("InvalidAccessKeyId");
  });

  test("D1 SELECT 1 failure fails setup", async () => {
    const cwd = tempProject();
    const run = runScript([
      { match: "whoami", result: { status: 0, stdout: "You are logged in", stderr: "" } },
      {
        match: "d1 list",
        result: { status: 0, stdout: JSON.stringify([{ name: "opencms", uuid: D1_ID }]), stderr: "" },
      },
      { match: "secret put", result: { status: 0, stdout: "", stderr: "" } },
      { match: "d1 execute", result: { status: 1, stdout: "", stderr: "Authentication error" } },
    ]);
    const result = await runSetup(
      {
        projectName: "edge",
        adminEmail: "a@b.co",
        adminName: "A",
        backend: cloudflare({ workerName: "opencms-api", d1Name: "opencms" }),
      },
      { cwd, io: new FakeIO([""]), run, generateSecret: () => "s" },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("did not respond");
  });
});
