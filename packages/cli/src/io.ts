/**
 * Terminal IO behind an interface so the wizard is fully scriptable in tests.
 *
 * This package runs under `npx` as well as `bunx`, so only `node:` builtins
 * may be imported here. Nothing in the CLI may touch `bun:*`.
 */
import { createInterface } from "node:readline/promises";

export interface IO {
  write(text: string): void;
  question(prompt: string): Promise<string>;
  close(): void;
  readonly colorEnabled: boolean;
}

export function createTerminalIO(): IO {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => {
    process.stdout.write("\nAborted. Nothing was written.\n");
    process.exit(130);
  });
  return {
    write: (text) => process.stdout.write(text),
    question: (prompt) => rl.question(prompt),
    close: () => rl.close(),
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
    enabled ? `[${open}m${text}[${close}m` : text;
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    cyan: wrap(36, 39),
    green: wrap(32, 39),
    red: wrap(31, 39),
  };
}
