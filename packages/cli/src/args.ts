export interface CliArgs {
  command?: string;
  /** Explicit output path; implies overwriting without asking. */
  out?: string;
  /** False when --no-write was passed: print to stdout only. */
  write: boolean;
  /** False when --no-setup was passed: generate the prompt only. */
  setup: boolean;
  /** Skip the confirmation in `opencms setup`. */
  yes: boolean;
  /** Working directory for `opencms setup`. */
  cwd?: string;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): CliArgs | { error: string } {
  const args: CliArgs = { write: true, setup: true, yes: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") args.help = true;
    else if (arg === "-v" || arg === "--version") args.version = true;
    else if (arg === "--no-write") args.write = false;
    else if (arg === "--no-setup") args.setup = false;
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--cwd" || arg.startsWith("--cwd=")) {
      const value = arg.includes("=") ? arg.slice("--cwd=".length) : argv[++i];
      if (!value) return { error: "--cwd needs a directory." };
      args.cwd = value;
    } else if (arg === "--out" || arg.startsWith("--out=")) {
      const value = arg.includes("=") ? arg.slice("--out=".length) : argv[++i];
      if (!value) return { error: "--out needs a file path." };
      args.out = value;
    } else if (arg.startsWith("-")) {
      return { error: `Unknown option: ${arg}` };
    } else if (args.command === undefined) {
      args.command = arg;
    } else {
      return { error: `Unexpected argument: ${arg}` };
    }
  }
  if (args.out !== undefined && !args.write) {
    return { error: "--out and --no-write contradict each other." };
  }
  return args;
}
