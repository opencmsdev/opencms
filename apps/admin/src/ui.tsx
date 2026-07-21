import type { ReactNode } from "react";
import { ApiError } from "./api.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Small shared pieces on top of the shadcn primitives, per DESIGN.md. */

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

export function PageHeader({ eyebrow, title, actions }: {
  eyebrow: string;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="text-3xl text-ink tracking-[-0.03em]">{title}</h1>
      </div>
      {actions ? <div className="flex gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="eyebrow">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-xs text-mute">{hint}</p> : null}
    </div>
  );
}

/** Native-feeling wrapper around the Radix select for simple value lists. */
export function SimpleSelect({ value, onValueChange, options, placeholder, ariaLabel, className, id }: {
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  id?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label={ariaLabel} className={`w-full ${className ?? ""}`} id={id}>
        <SelectValue placeholder={placeholder ?? "select..."} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A destructive action gated behind an AlertDialog confirmation. */
export function ConfirmButton({ label, title, description, onConfirm, disabled, size }: {
  label: string;
  title: string;
  description: string;
  onConfirm: () => void;
  disabled?: boolean;
  size?: "default" | "sm";
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size={size ?? "default"} disabled={disabled}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const issues = error instanceof ApiError ? error.issues : undefined;
  return (
    <Alert variant="destructive">
      <AlertTitle>{message}</AlertTitle>
      {issues?.length ? (
        <AlertDescription>
          <ul className="text-xs">
            {issues.map((i, n) => (
              <li key={n}>
                <span className="font-mono">{i.path}</span>: {i.message}
              </li>
            ))}
          </ul>
        </AlertDescription>
      ) : null}
    </Alert>
  );
}

export function StatusDot({ status }: { status: "draft" | "published" }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal text-body">
      <span
        className={`inline-block size-1.5 rounded-full ${
          status === "published" ? "bg-breeze" : "bg-mute"
        }`}
      />
      {status}
    </Badge>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="text-ink text-lg tracking-[-0.02em]">{title}</div>
        {children ? <div className="text-sm text-mute max-w-md">{children}</div> : null}
      </CardContent>
    </Card>
  );
}
