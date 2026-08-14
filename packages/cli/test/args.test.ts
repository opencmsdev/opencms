import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/args.ts";

describe("parseArgs", () => {
  test("plain init", () => {
    expect(parseArgs(["init"])).toEqual({
      command: "init",
      write: true,
      setup: true,
      yes: false,
      help: false,
      version: false,
    });
  });

  test("--no-setup keeps the wizard prompt-only", () => {
    expect(parseArgs(["init", "--no-setup"])).toMatchObject({ command: "init", setup: false });
  });

  test("--out with a space and with =", () => {
    expect(parseArgs(["init", "--out", "prompt.md"])).toMatchObject({ command: "init", out: "prompt.md" });
    expect(parseArgs(["init", "--out=prompt.md"])).toMatchObject({ command: "init", out: "prompt.md" });
    expect(parseArgs(["init", "--out"])).toEqual({ error: "--out needs a file path." });
  });

  test("--no-write", () => {
    expect(parseArgs(["init", "--no-write"])).toMatchObject({ command: "init", write: false });
    expect(parseArgs(["init", "--out=x.md", "--no-write"])).toEqual({
      error: "--out and --no-write contradict each other.",
    });
  });

  test("help and version flags", () => {
    expect(parseArgs(["--help"])).toMatchObject({ help: true });
    expect(parseArgs(["-v"])).toMatchObject({ version: true });
    expect(parseArgs([])).toEqual({ write: true, setup: true, yes: false, help: false, version: false });
  });

  test("setup flags", () => {
    expect(parseArgs(["setup"])).toMatchObject({ command: "setup", yes: false });
    expect(parseArgs(["setup", "--yes"])).toMatchObject({ command: "setup", yes: true });
    expect(parseArgs(["setup", "-y", "--cwd", "/tmp/site"])).toMatchObject({
      command: "setup",
      yes: true,
      cwd: "/tmp/site",
    });
    expect(parseArgs(["setup", "--cwd"])).toEqual({ error: "--cwd needs a directory." });
  });

  test("unknown input errors", () => {
    expect(parseArgs(["init", "--frobnicate"])).toEqual({ error: "Unknown option: --frobnicate" });
    expect(parseArgs(["init", "extra"])).toEqual({ error: "Unexpected argument: extra" });
  });
});
