#!/usr/bin/env node
/**
 * `opencms` CLI entry point. Runs under plain Node (npx) and under Bun
 * (bunx); nothing below this file may import from `bun:*`.
 *
 *   opencms init            wizard, project clone, agent prompt in clipboard
 *   opencms init --no-setup wizard and prompt only, no clone
 *   opencms setup           provision integrations from opencms.config.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "./args.ts";
import { copyToClipboard } from "./clipboard.ts";
import { createTerminalIO, palette } from "./io.ts";
import { loadConfig } from "./load-config.ts";
import { confirm } from "./prompts.ts";
import { renderAgentPrompt } from "./render.ts";
import { projectDirName, scaffold } from "./scaffold.ts";
import { runSetup } from "./setup.ts";
import { createRun } from "./wrangler.ts";
import { runWizard } from "./wizard.ts";

const DEFAULT_OUT = "opencms-agent-prompt.md";

const HELP = `opencms: the OpenCMS command line

Usage:
  opencms init [--no-setup] [--out <file>] [--no-write]
  opencms setup [--cwd <dir>] [--yes]

Commands:
  init            Interactive wizard. Picks backend, frontend, cache and
                  storage, clones the repo into ./<project>, writes
                  opencms.config.ts, and prints an agent-ready prompt.

  setup           Read opencms.config.ts in the current directory and
                  create whatever those integrations need: D1 / R2 on
                  Cloudflare, S3 keys in .env, auth secrets. Then each
                  integration tests its connection (D1 SELECT 1, R2
                  ListObjects). Safe to re-run.

Options for init:
  --no-setup      Skip the clone; generate the prompt only.
  --out <file>    Save the prompt to <file> (default: ${DEFAULT_OUT}
                  inside the project folder).
  --no-write      Print the prompt to stdout only.

Options for setup:
  --cwd <dir>     Project directory (default: current directory).
  -y, --yes       Skip the confirmation prompt.

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

async function init(out: string | undefined, write: boolean, setup: boolean): Promise<number> {
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

    let projectDir: string | undefined;
    if (setup) {
      const candidate = projectDirName(config.projectName);
      const wantSetup = await confirm(io, `Clone OpenCMS and set up ./${candidate} now?`, true);
      if (wantSetup) {
        const result = scaffold(config, candidate, io);
        if (result.ok) {
          projectDir = candidate;
        } else {
          io.write(`${c.red("✖")} Setup skipped: ${result.error}. Continuing with the prompt only.\n`);
        }
      }
    }
    const scaffolded = projectDir !== undefined;

    let outPath = write
      ? resolve(out ?? (projectDir ? join(projectDir, DEFAULT_OUT) : DEFAULT_OUT))
      : undefined;
    if (outPath !== undefined && out === undefined && existsSync(outPath)) {
      const overwrite = await confirm(io, `${outPath} exists. Overwrite it?`, false);
      if (!overwrite) outPath = undefined;
    }

    const prompt = renderAgentPrompt(config, { scaffolded });
    const rule = c.dim("=".repeat(72));
    io.write(`\n${rule}\n\n${prompt}\n${rule}\n\n`);
    if (outPath !== undefined) {
      writeFileSync(outPath, prompt);
      io.write(`${c.green("✔")} Saved: ${outPath}\n`);
    }

    const copied = copyToClipboard(prompt, (chunk) => io.write(chunk));
    if (copied === "copied") {
      io.write(`${c.green("✔")} Prompt copied to your clipboard.\n`);
    } else if (copied === "osc52") {
      io.write(`${c.green("✔")} Prompt sent to your clipboard (OSC 52, terminal permitting).\n`);
    } else {
      io.write(c.dim("No clipboard tool found; copy the prompt above manually.\n"));
    }

    io.write(
      scaffolded
        ? `\nNext: ${c.bold(`cd ${projectDir} && bunx opencms setup`)}\nthen paste the prompt into your coding agent if you want CORS / admin bootstrap done for you.\n`
        : "\nPaste the prompt into your coding agent (Claude Code, Cursor, ...)\nand it will set everything up.\n",
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

async function setup(cwd: string, yes: boolean): Promise<number> {
  if (!process.stdin.isTTY && !yes) {
    process.stderr.write("opencms setup is interactive; run it in a terminal or pass --yes.\n");
    return 1;
  }
  const io = createTerminalIO();
  const c = palette(io.colorEnabled);
  try {
    const config = await loadConfig(cwd);
    const result = await runSetup(config, { cwd, io, run: createRun(), yes });
    if (!result.ok) {
      io.write(`${c.red("✖")} ${result.error}\n`);
      return 1;
    }
    return 0;
  } catch (err) {
    if (isStdinAbort(err)) {
      process.stdout.write("\nAborted. Nothing was written.\n");
      return 130;
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    return 1;
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
  if (parsed.command === "init") return init(parsed.out, parsed.write, parsed.setup);
  if (parsed.command === "setup") return setup(resolve(parsed.cwd ?? process.cwd()), parsed.yes);
  process.stderr.write(`Unknown command: ${parsed.command}\n\n${HELP}`);
  return 1;
}

process.exitCode = await main();
