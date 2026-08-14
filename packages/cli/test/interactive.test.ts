import { describe, expect, test } from "bun:test";
import { parseKeys } from "../src/io.ts";
import { confirm, select } from "../src/prompts.ts";
import { runWizard } from "../src/wizard.ts";
import { KeyedFakeIO } from "./fake-io.ts";

const BACKENDS = [
  { value: "bun-sqlite", label: "Self-hosted: Bun + SQLite" },
  { value: "cloudflare", label: "Cloudflare Workers + D1" },
] as const;

describe("parseKeys", () => {
  test("arrow keys, both CSI and SS3 encodings", () => {
    expect(parseKeys("\u001b[A")).toEqual(["up"]);
    expect(parseKeys("\u001bOB")).toEqual(["down"]);
  });

  test("several keys in one chunk stay in order", () => {
    expect(parseKeys("\u001b[B\u001b[B\r")).toEqual(["down", "down", "enter"]);
  });

  test("enter variants collapse to one key", () => {
    expect(parseKeys("\r\n")).toEqual(["enter"]);
    expect(parseKeys("\n")).toEqual(["enter"]);
  });

  test("control keys", () => {
    expect(parseKeys("\u0003")).toEqual(["ctrl-c"]);
    expect(parseKeys("\u001b")).toEqual(["escape"]);
    expect(parseKeys(" ")).toEqual(["space"]);
  });

  test("unknown escape sequences are swallowed whole", () => {
    expect(parseKeys("\u001b[C")).toEqual([]);
    expect(parseKeys("\u001b[Cx")).toEqual(["x"]);
    expect(parseKeys("\u001b[1;5D")).toEqual([]);
  });

  test("plain characters come through one by one", () => {
    expect(parseKeys("jk")).toEqual(["j", "k"]);
  });
});

describe("interactive select", () => {
  test("arrow down then enter picks the second choice", async () => {
    const io = new KeyedFakeIO([], ["\u001b[B", "\r"]);
    expect(await select(io, "Backend?", BACKENDS)).toBe("cloudflare");
    expect(io.output).toContain("❯");
    expect(io.output).toContain("↑/↓ move, Enter to select");
  });

  test("space also confirms, on the focused default", async () => {
    const io = new KeyedFakeIO([], [" "]);
    expect(await select(io, "Backend?", BACKENDS, { defaultValue: "cloudflare" })).toBe(
      "cloudflare",
    );
  });

  test("j/k vim keys navigate and wrap around", async () => {
    const io = new KeyedFakeIO([], ["k", "\r"]);
    expect(await select(io, "Backend?", BACKENDS)).toBe("cloudflare");
  });

  test("a multi-key chunk is applied in order", async () => {
    const io = new KeyedFakeIO([], ["\u001b[B\u001b[B\r"]);
    expect(await select(io, "Backend?", BACKENDS)).toBe("bun-sqlite");
  });

  test("ctrl-c aborts with an ABORT_ERR error", async () => {
    const io = new KeyedFakeIO([], ["\u0003"]);
    await expect(select(io, "Backend?", BACKENDS)).rejects.toMatchObject({ code: "ABORT_ERR" });
  });
});

describe("interactive confirm", () => {
  test("enter takes the focused default", async () => {
    expect(await confirm(new KeyedFakeIO([], ["\r"]), "Sure?", true)).toBe(true);
    expect(await confirm(new KeyedFakeIO([], ["\r"]), "Sure?", false)).toBe(false);
  });

  test("arrows move between Yes and No", async () => {
    expect(await confirm(new KeyedFakeIO([], ["\u001b[B", "\r"]), "Sure?", true)).toBe(false);
    expect(await confirm(new KeyedFakeIO([], ["\u001b[A", "\r"]), "Sure?", false)).toBe(true);
  });
});

describe("runWizard through interactive IO", () => {
  test("full self-hosted flow driven by keys and text answers", async () => {
    const io = new KeyedFakeIO(
      [
        "blog", // project name
        "", // public URL -> default
        "", // port -> default
        "", // db file -> default
        "me@example.com", // admin email
        "", // admin name -> Admin
      ],
      [
        "\r", // backend: first choice (bun-sqlite)
        "\r", // frontend: default (none)
        "\r", // cache: default (none)
        "\r", // storage: default (none)
        "\r", // final confirm: default (yes)
      ],
    );
    const config = await runWizard(io);
    expect(config).toMatchObject({
      projectName: "blog",
      adminEmail: "me@example.com",
      adminName: "Admin",
      backend: { kind: "bun-sqlite", publicUrl: "http://localhost:3000", port: 3000, dbPath: "opencms.db" },
      frontend: undefined,
      cache: undefined,
      storage: undefined,
    });
  });
});
