import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/args.ts";

describe("parseArgs", () => {
  test("plain init", () => {
    expect(parseArgs(["init"])).toEqual({ command: "init", write: true, help: false, version: false });
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
    expect(parseArgs([])).toEqual({ write: true, help: false, version: false });
  });

  test("unknown input errors", () => {
    expect(parseArgs(["init", "--frobnicate"])).toEqual({ error: "Unknown option: --frobnicate" });
    expect(parseArgs(["init", "extra"])).toEqual({ error: "Unexpected argument: extra" });
  });
});
