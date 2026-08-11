/**
 * Best-effort clipboard support with zero dependencies: a native clipboard
 * tool when one exists, otherwise the OSC 52 escape sequence, which most
 * modern terminals translate into a clipboard write even over SSH.
 */
import { spawnSync } from "node:child_process";

/** Candidate clipboard commands for a platform, tried in order. */
export function clipboardCommands(platform: NodeJS.Platform): Array<[string, string[]]> {
  if (platform === "darwin") return [["pbcopy", []]];
  if (platform === "win32") return [["clip", []]];
  return [
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
    ["xsel", ["--clipboard", "--input"]],
  ];
}

/** OSC 52 clipboard-write sequence for the given text. */
export function osc52(text: string): string {
  return `\u001b]52;c;${Buffer.from(text, "utf8").toString("base64")}\u0007`;
}

export type CopyOutcome = "copied" | "osc52" | "failed";

export function copyToClipboard(
  text: string,
  write: (chunk: string) => void,
  opts: { platform?: NodeJS.Platform; toTty?: boolean } = {},
): CopyOutcome {
  for (const [cmd, args] of clipboardCommands(opts.platform ?? process.platform)) {
    const res = spawnSync(cmd, args, { input: text, stdio: ["pipe", "ignore", "ignore"] });
    if (!res.error && res.status === 0) return "copied";
  }
  if (opts.toTty ?? Boolean(process.stdout.isTTY)) {
    write(osc52(text));
    return "osc52";
  }
  return "failed";
}
