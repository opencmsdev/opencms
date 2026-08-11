/**
 * Terminal IO behind an interface so the wizard is fully scriptable in tests.
 *
 * This package runs under `npx` as well as `bunx`, so only `node:` builtins
 * may be imported here. Nothing in the CLI may touch `bun:*`.
 *
 * Two input modes:
 * - `question` reads a full line (free text). A readline interface is created
 *   per question and closed right after, so it never competes with raw reads.
 * - `readKeys` reads raw keypresses (arrow-key selects). Only present when
 *   both stdin and stdout are TTYs; callers must fall back to line input
 *   otherwise (pipes, dumb terminals, tests).
 */
import { createInterface } from "node:readline/promises";

const ESC = "\u001b";
const CTRL_C = "\u0003";

export interface IO {
  write(text: string): void;
  question(prompt: string): Promise<string>;
  /** Raw keypresses, parsed into key names. Absent = use line-input fallback. */
  readKeys?(): Promise<string[]>;
  close(): void;
  readonly colorEnabled: boolean;
}

/**
 * Parses a raw stdin chunk into a sequence of key names. A single chunk can
 * carry several keys (held-down arrows, pasted text), so this returns all of
 * them in order. Special keys become names ("up", "down", "enter", "space",
 * "escape", "ctrl-c"); everything else comes through as its character.
 */
export function parseKeys(data: string): string[] {
  const keys: string[] = [];
  let i = 0;
  while (i < data.length) {
    const rest = data.slice(i);
    if (rest.startsWith(`${ESC}[A`) || rest.startsWith(`${ESC}OA`)) {
      keys.push("up");
      i += 3;
    } else if (rest.startsWith(`${ESC}[B`) || rest.startsWith(`${ESC}OB`)) {
      keys.push("down");
      i += 3;
    } else if (rest.startsWith("\r")) {
      keys.push("enter");
      i += rest.startsWith("\r\n") ? 2 : 1;
    } else if (rest.startsWith("\n")) {
      keys.push("enter");
      i += 1;
    } else if (rest.startsWith(CTRL_C)) {
      keys.push("ctrl-c");
      i += 1;
    } else if (rest.startsWith(" ")) {
      keys.push("space");
      i += 1;
    } else if (rest === ESC) {
      keys.push("escape");
      i += 1;
    } else if (rest.startsWith(ESC)) {
      // Unrecognized escape sequence (other cursor keys, function keys):
      // swallow it whole so its tail is not misread as typed characters.
      const match = /^\u001b\[?O?[0-9;]*[A-Za-z~]/.exec(rest);
      i += match ? match[0].length : 1;
    } else {
      keys.push(rest[0]!);
      i += 1;
    }
  }
  return keys;
}

export function createTerminalIO(): IO {
  const question = (prompt: string) =>
    new Promise<string>((resolve, reject) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.on("SIGINT", () => {
        process.stdout.write("\nAborted. Nothing was written.\n");
        process.exit(130);
      });
      rl.question(prompt).then(
        (answer) => {
          rl.close();
          resolve(answer);
        },
        (err) => {
          rl.close();
          reject(err);
        },
      );
    });

  const interactive = Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
  const readKeys = () =>
    new Promise<string[]>((resolve) => {
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.once("data", (buf: Buffer) => {
        stdin.setRawMode(false);
        stdin.pause();
        resolve(parseKeys(buf.toString("utf8")));
      });
    });

  return {
    write: (text) => process.stdout.write(text),
    question,
    ...(interactive ? { readKeys } : {}),
    close: () => {},
    colorEnabled: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
  };
}

export interface Palette {
  bold(text: string): string;
  dim(text: string): string;
  cyan(text: string): string;
  green(text: string): string;
  red(text: string): string;
}

export function palette(enabled: boolean): Palette {
  const wrap = (open: number, close: number) => (text: string) =>
    enabled ? `${ESC}[${open}m${text}${ESC}[${close}m` : text;
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    cyan: wrap(36, 39),
    green: wrap(32, 39),
    red: wrap(31, 39),
  };
}

/** Cursor and line-control sequences used by the interactive prompts. */
export const term = {
  hideCursor: `${ESC}[?25l`,
  showCursor: `${ESC}[?25h`,
  clearLine: `${ESC}[2K`,
  up: (lines: number) => `${ESC}[${lines}A`,
};
