/**
 * A minimal prompt toolkit over the IO interface: select, free text with
 * validation, and yes/no confirm. When the IO supports raw key input (real
 * TTYs), select and confirm are arrow-key driven with a highlighted cursor;
 * otherwise they fall back to numbered/typed input so pipes, dumb terminals
 * and scripted tests keep working. Invalid input reprompts in a loop, so
 * callers always get a valid value back.
 */
import type { IO } from "./io.ts";
import { palette, term } from "./io.ts";

export interface SelectChoice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** Thrown when the user aborts an interactive prompt (Ctrl+C or Escape). */
export function abortError(): Error {
  const err = new Error("aborted by user");
  (err as Error & { code: string }).code = "ABORT_ERR";
  return err;
}

async function interactiveSelect<T extends string>(
  io: IO,
  title: string,
  choices: ReadonlyArray<SelectChoice<T>>,
  defaultValue?: T,
): Promise<T> {
  const c = palette(io.colorEnabled);
  const count = choices.length;
  let index = Math.max(
    0,
    choices.findIndex((choice) => choice.value === defaultValue),
  );

  const render = (redraw: boolean) => {
    let out = redraw ? term.up(count + 1) : "";
    for (const [i, choice] of choices.entries()) {
      const active = i === index;
      const marker = active ? c.cyan("❯") : " ";
      const label = active ? c.cyan(choice.label) : choice.label;
      const hint = choice.hint ? c.dim(`  ${choice.hint}`) : "";
      out += `${term.clearLine} ${marker} ${label}${hint}\n`;
    }
    out += `${term.clearLine}  ${c.dim("↑/↓ move, Enter to select")}\n`;
    io.write(out);
  };

  /** Collapse the list to a single confirmation line once a choice is made. */
  const finish = () => {
    let out = term.up(count + 1);
    for (let i = 0; i < count + 1; i++) out += `${term.clearLine}\n`;
    out += term.up(count + 1);
    out += ` ${c.green("❯")} ${choices[index]!.label}\n`;
    io.write(out);
  };

  io.write(`\n${c.bold(title)}\n`);
  io.write(term.hideCursor);
  try {
    render(false);
    for (;;) {
      const keys = await io.readKeys!();
      let chosen = false;
      for (const key of keys) {
        if (key === "up" || key === "k") index = (index - 1 + count) % count;
        else if (key === "down" || key === "j") index = (index + 1) % count;
        else if (key === "enter" || key === "space") chosen = true;
        else if (key === "ctrl-c" || key === "escape") throw abortError();
      }
      if (chosen) break;
      render(true);
    }
    finish();
    return choices[index]!.value;
  } finally {
    io.write(term.showCursor);
  }
}

export async function select<T extends string>(
  io: IO,
  title: string,
  choices: ReadonlyArray<SelectChoice<T>>,
  opts: { defaultValue?: T } = {},
): Promise<T> {
  if (io.readKeys) return interactiveSelect(io, title, choices, opts.defaultValue);

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
    const raw = (await io.question(`\n${c.bold(title)}${suffix}\n  ${c.cyan(">")} `)).trim();
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
  if (io.readKeys) {
    const choice = await interactiveSelect(
      io,
      title,
      [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
      defaultValue ? "yes" : "no",
    );
    return choice === "yes";
  }

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
