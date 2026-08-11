/**
 * A minimal prompt toolkit over the IO interface: numbered select, free text
 * with validation, and yes/no confirm. Invalid input reprompts in a loop, so
 * callers always get a valid value back.
 */
import type { IO } from "./io.ts";
import { palette } from "./io.ts";

export interface SelectChoice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export async function select<T extends string>(
  io: IO,
  title: string,
  choices: ReadonlyArray<SelectChoice<T>>,
  opts: { defaultValue?: T } = {},
): Promise<T> {
  const c = palette(io.colorEnabled);
  io.write(`\n${c.bold(title)}\n`);
  for (const [i, choice] of choices.entries()) {
    const mark = choice.value === opts.defaultValue ? c.green("*") : " ";
    const hint = choice.hint ? c.dim(`  (${choice.hint})`) : "";
    io.write(` ${mark} ${c.cyan(String(i + 1))}) ${choice.label}${hint}\n`);
  }
  const def = opts.defaultValue;
  const suffix = def === undefined ? "" : ` ${c.dim(`(Enter = ${def})`)}`;
  for (;;) {
    const raw = (await io.question(`  Choose 1-${choices.length}${suffix}: `)).trim();
    if (raw === "" && def !== undefined) return def;
    const byNumber = /^\d+$/.test(raw) ? choices[Number(raw) - 1] : undefined;
    if (byNumber) return byNumber.value;
    const byValue = choices.find((choice) => choice.value === raw);
    if (byValue) return byValue.value;
    io.write(c.red(`  Enter a number between 1 and ${choices.length}.\n`));
  }
}

export async function text(
  io: IO,
  title: string,
  opts: {
    defaultValue?: string;
    required?: boolean;
    /** Returns an error message to reprompt with, or undefined when valid. */
    validate?: (value: string) => string | undefined;
  } = {},
): Promise<string> {
  const c = palette(io.colorEnabled);
  const def = opts.defaultValue;
  const suffix =
    def !== undefined && def !== ""
      ? ` ${c.dim(`(Enter = ${def})`)}`
      : opts.required
        ? ""
        : ` ${c.dim("(Enter to skip)")}`;
  for (;;) {
    const raw = (await io.question(`\n${c.bold(title)}${suffix}\n  > `)).trim();
    const value = raw === "" && def !== undefined ? def : raw;
    if (value === "") {
      if (!opts.required) return "";
      io.write(c.red("  A value is required.\n"));
      continue;
    }
    const error = opts.validate?.(value);
    if (error) {
      io.write(c.red(`  ${error}\n`));
      continue;
    }
    return value;
  }
}

export async function confirm(io: IO, title: string, defaultValue: boolean): Promise<boolean> {
  const c = palette(io.colorEnabled);
  const hint = defaultValue ? "Y/n" : "y/N";
  for (;;) {
    const raw = (await io.question(`\n${c.bold(title)} ${c.dim(`[${hint}]`)} `)).trim().toLowerCase();
    if (raw === "") return defaultValue;
    if (raw === "y" || raw === "yes") return true;
    if (raw === "n" || raw === "no") return false;
    io.write(c.red("  Answer y or n.\n"));
  }
}
