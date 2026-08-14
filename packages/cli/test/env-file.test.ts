import { describe, expect, test } from "bun:test";
import { parseEnv, upsertEnv } from "../src/env-file.ts";

describe("parseEnv", () => {
  test("reads keys, skips comments and blanks", () => {
    expect(
      parseEnv("# hi\nFOO=bar\n\n# skip\nBAZ=qux\n"),
    ).toEqual({ FOO: "bar", BAZ: "qux" });
  });
});

describe("upsertEnv", () => {
  test("appends new keys and keeps comments", () => {
    const out = upsertEnv("# generated\nFOO=old\n", { FOO: "new", BAR: "x" });
    expect(out).toContain("# generated");
    expect(out).toContain("FOO=old");
    expect(out).toContain("BAR=x");
    expect(out.endsWith("\n")).toBe(true);
  });

  test("overwrite replaces an existing value", () => {
    expect(upsertEnv("FOO=old\n", { FOO: "new" }, { overwrite: true })).toBe("FOO=new\n");
  });

  test("undefined updates are ignored", () => {
    expect(upsertEnv("FOO=old\n", { FOO: undefined, BAR: "x" })).toBe("FOO=old\nBAR=x\n");
  });
});
