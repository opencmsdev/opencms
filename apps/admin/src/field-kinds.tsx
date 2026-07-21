import { useState } from "react";
import type { ComponentType } from "react";
import { Popover } from "radix-ui";
import {
  AlignLeft,
  Braces,
  Calendar,
  Check,
  ChevronDown,
  Hash,
  Image,
  Link2,
  ListChecks,
  ToggleLeft,
  Type,
} from "lucide-react";
import type { FieldDef } from "./api.ts";

/**
 * One place that describes every field kind: its icon and a one-line
 * explanation. Drives the rich kind picker in the content-type builder,
 * and can be reused wherever a kind needs a human label.
 */
export interface KindMeta {
  kind: FieldDef["kind"];
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
}

export const FIELD_KINDS: KindMeta[] = [
  { kind: "text", label: "Text", hint: "A single line of plain text, like a title.", icon: Type },
  { kind: "richtext", label: "Rich text", hint: "Long-form, multi-line body content.", icon: AlignLeft },
  { kind: "number", label: "Number", hint: "A numeric value, whole or decimal.", icon: Hash },
  { kind: "boolean", label: "Boolean", hint: "A true or false toggle.", icon: ToggleLeft },
  { kind: "date", label: "Date", hint: "A date and time.", icon: Calendar },
  { kind: "select", label: "Select", hint: "One choice from a fixed list of options.", icon: ListChecks },
  { kind: "json", label: "JSON", hint: "Arbitrary structured data.", icon: Braces },
  { kind: "reference", label: "Reference", hint: "A link to an entry of another type.", icon: Link2 },
  { kind: "media", label: "Media", hint: "An uploaded file or image.", icon: Image },
];

const KIND_BY_NAME = new Map(FIELD_KINDS.map((k) => [k.kind, k]));

export function kindMeta(kind: FieldDef["kind"]): KindMeta {
  return KIND_BY_NAME.get(kind) ?? FIELD_KINDS[0]!;
}

export function KindSelect({ value, onChange, id }: {
  value: FieldDef["kind"];
  onChange: (kind: FieldDef["kind"]) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = kindMeta(value);
  const CurrentIcon = current.icon;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        id={id}
        aria-label="Kind"
        className="flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm text-ink outline-none transition-colors hover:bg-secondary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-secondary"
      >
        <CurrentIcon className="size-4 text-mute" />
        <span>{current.label}</span>
        <ChevronDown className="ml-auto size-4 text-mute" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          role="listbox"
          align="start"
          sideOffset={6}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-72 rounded-lg border border-border bg-popover p-1 text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          {FIELD_KINDS.map((k) => {
            const Icon = k.icon;
            const selected = k.kind === value;
            return (
              <button
                key={k.kind}
                type="button"
                role="option"
                aria-label={k.kind}
                aria-selected={selected}
                onClick={() => {
                  onChange(k.kind);
                  setOpen(false);
                }}
                className={`flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-secondary ${
                  selected ? "bg-secondary" : ""
                }`}
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-hairline bg-canvas-soft">
                  <Icon className="size-4 text-body" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm text-ink">{k.label}</span>
                    <span className="font-mono text-[0.65rem] uppercase tracking-wider text-mute">{k.kind}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-mute">{k.hint}</span>
                </span>
                {selected ? <Check className="mt-1.5 size-4 shrink-0 text-ink" /> : null}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
