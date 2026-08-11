import { describe, expect, test } from "bun:test";
import { clipboardCommands, osc52 } from "../src/clipboard.ts";

describe("osc52", () => {
  test("wraps base64 text in the OSC 52 clipboard sequence", () => {
    expect(osc52("hi")).toBe("\u001b]52;c;aGk=\u0007");
  });
});

describe("clipboardCommands", () => {
  test("per-platform candidates in order", () => {
    expect(clipboardCommands("darwin")).toEqual([["pbcopy", []]]);
    expect(clipboardCommands("win32")).toEqual([["clip", []]]);
    expect(clipboardCommands("linux").map(([cmd]) => cmd)).toEqual(["wl-copy", "xclip", "xsel"]);
  });
});
