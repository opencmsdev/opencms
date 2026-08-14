import { describe, expect, test } from "bun:test";
import { runWizard } from "../src/wizard.ts";
import { confirm, select, text } from "../src/prompts.ts";
import { FakeIO } from "./fake-io.ts";

describe("runWizard", () => {
  test("self-hosted defaults with a Vercel frontend", async () => {
    const io = new FakeIO([
      "", // project name -> my-site
      "1", // backend: bun-sqlite
      "", // public URL -> http://localhost:3000
      "", // port -> 3000
      "", // db file -> opencms.db
      "2", // frontend: vercel
      "https://blog.example.com/home", // production URL
      "http://localhost:5173", // extra origins
      "", // cookies -> no
      "", // cache -> none
      "", // storage -> none
      "me@example.com", // admin email
      "", // admin name -> Admin
      "", // confirm -> yes
    ]);
    const config = await runWizard(io);
    expect(config).toMatchObject({
      projectName: "my-site",
      adminEmail: "me@example.com",
      adminName: "Admin",
      backend: { kind: "bun-sqlite", publicUrl: "http://localhost:3000", port: 3000, dbPath: "opencms.db" },
      frontend: {
        host: "vercel",
        url: "https://blog.example.com/home",
        extraOrigins: ["http://localhost:5173"],
        credentials: false,
      },
      cache: undefined,
      storage: undefined,
    });
    expect(io.output).toContain("Summary");
  });

  test("cloudflare with custom domain, no frontend, CDN cache", async () => {
    const io = new FakeIO([
      "edge-site", // project name
      "2", // backend: cloudflare
      "", // worker name -> opencms-api
      "", // d1 name -> opencms
      "CMS.Example.com", // custom domain, gets lowercased
      "", // frontend -> none
      "2", // cache: cloudflare-cdn
      "", // ttl -> 60
      "", // storage -> none
      "me@example.com", // admin email
      "Mehdi", // admin name
      "y", // confirm
    ]);
    const config = await runWizard(io);
    expect(config).toMatchObject({
      projectName: "edge-site",
      adminEmail: "me@example.com",
      adminName: "Mehdi",
      backend: { kind: "cloudflare", workerName: "opencms-api", d1Name: "opencms", customDomain: "cms.example.com" },
      frontend: undefined,
      cache: { kind: "cloudflare-cdn", ttlSeconds: 60 },
      storage: undefined,
    });
  });

  test("invalid answers reprompt until valid", async () => {
    const io = new FakeIO([
      "blog", // project name
      "", // backend: empty not allowed (no default), reprompts
      "9", // backend: out of range, reprompts
      "1", // backend: bun-sqlite
      "not a url", // public URL: invalid, reprompts
      "http://localhost:4000", // public URL
      "", // port -> 4000, inferred from the URL
      "", // db file
      "", // frontend -> none
      "", // cache -> none
      "", // storage -> none
      "nope", // admin email: invalid, reprompts
      "me@example.com", // admin email
      "", // admin name
      "", // confirm -> yes
    ]);
    const config = await runWizard(io);
    expect(config?.backend).toMatchObject({
      kind: "bun-sqlite",
      publicUrl: "http://localhost:4000",
      port: 4000,
      dbPath: "opencms.db",
    });
    expect(io.output).toContain("Enter a number between 1 and 2.");
    expect(io.output).toContain("not a valid URL");
    expect(io.output).toContain("does not look like an email address");
  });

  test("declining the summary returns null", async () => {
    const io = new FakeIO([
      "blog",
      "1",
      "",
      "",
      "",
      "", // frontend -> none
      "", // cache -> none
      "", // storage -> none
      "me@example.com",
      "",
      "n", // confirm -> no
    ]);
    expect(await runWizard(io)).toBeNull();
  });

  test("same-origin frontend asks no CORS questions", async () => {
    const io = new FakeIO([
      "blog",
      "1",
      "",
      "",
      "",
      "5", // frontend: same-origin
      "", // cache -> none
      "", // storage -> none
      "me@example.com",
      "",
      "",
    ]);
    const config = await runWizard(io);
    expect(config?.frontend).toEqual({ host: "same-origin", extraOrigins: [], credentials: false });
  });
});

describe("prompts", () => {
  test("select accepts the value itself as an answer", async () => {
    const io = new FakeIO(["cloudflare"]);
    const value = await select(io, "Backend?", [
      { value: "bun-sqlite", label: "Bun" },
      { value: "cloudflare", label: "Workers" },
    ]);
    expect(value).toBe("cloudflare");
  });

  test("text without required returns empty on skip", async () => {
    const io = new FakeIO([""]);
    expect(await text(io, "Custom domain")).toBe("");
  });

  test("confirm reprompts on garbage", async () => {
    const io = new FakeIO(["maybe", "no"]);
    expect(await confirm(io, "Sure?", true)).toBe(false);
    expect(io.output).toContain("Answer y or n.");
  });
});
