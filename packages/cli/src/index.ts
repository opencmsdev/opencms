#!/usr/bin/env node
/**
 * `opencms` CLI entry point. Runs under plain Node (npx) and under Bun
 * (bunx); nothing below this file may import from `bun:*`.
 *
 *   opencms init            interactive wizard, prints an agent-ready prompt
 *   opencms init --out FILE also save the prompt to FILE (overwrites)
 *   opencms init --no-write print only, save nothing
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "./args.ts";
import { createTerminalIO, palette } from "./io.ts";
import { confirm } from "./prompts.ts";
import { renderAgentPrompt } from "./render.ts";
import { runWizard } from "./wizard.ts";

const DEFAULT_OUT = "opencms-agent-prompt.md";

const HELP = `opencms: the OpenCMS command line

Usage:
  opencms init [--out <file>] [--no-write]

Commands:
  init            Interactive setup wizard. Asks for backend (required),
                  frontend host and cache (optional) plus the data each choice
                  needs, then prints a ready-to-run prompt for a coding agent.

Options for init:
  --out <file>    Save the prompt to <file> (default: ${DEFAULT_OUT},
                  asked before overwriting unless --out is explicit).
  --no-write      Print the prompt to stdout only.

Global options:
  -h, --help      Show this help.
  -v, --version   Show the version.
`;

function version(): string {
  const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  return (JSON.parse(raw) as { version: string }).version;
}

/** Ctrl+D on a pending question, or any question after stdin closed. */
function isStdinAbort(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "ABORT_ERR" || code === "ERR_USE_AFTER_CLOSE";
}

async function init(out: string | undefined, write: boolean): Promise<number> {
  if (!process.stdin.isTTY) {
    process.stderr.write("opencms init is interactive; run it in a terminal.\n");
    return 1;
  }
  const io = createTerminalIO();
  const c = palette(io.colorEnabled);
  try {
    const config = await runWizard(io);
    if (config === null) {
      io.write("\nNothing generated. Run `opencms init` again to start over.\n");
      return 0;
    }

    let outPath = write ? resolve(out ?? DEFAULT_OUT) : undefined;
    if (outPath !== undefined && out === undefined && existsSync(outPath)) {
      const overwrite = await confirm(io, `${outPath} exists. Overwrite it?`, false);
      if (!overwrite) outPath = undefined;
    }

    const prompt = renderAgentPrompt(config);
    const rule = c.dim("=".repeat(72));
    io.write(`\n${rule}\n\n${prompt}\n${rule}\n\n`);
    if (outPath !== undefined) {
      writeFileSync(outPath, prompt);
      io.write(`${c.green("Saved:")} ${outPath}\n`);
    }
    io.write(
      "Paste the prompt above into your coding agent (Claude Code, Cursor, ...)\nand it will set everything up.\n",
    );
    return 0;
  } catch (err) {
    if (isStdinAbort(err)) {
      process.stdout.write("\nAborted. Nothing was written.\n");
      return 130;
    }
    throw err;
  } finally {
    io.close();
  }
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n\n${HELP}`);
    return 1;
  }
  if (parsed.version) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  if (parsed.help || parsed.command === undefined) {
    process.stdout.write(HELP);
    return 0;
  }
  if (parsed.command === "init") return init(parsed.out, parsed.write);
  process.stderr.write(`Unknown command: ${parsed.command}\n\n${HELP}`);
  return 1;
}

process.exitCode = await main();
