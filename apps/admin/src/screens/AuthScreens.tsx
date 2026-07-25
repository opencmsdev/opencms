import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ApiError, api } from "../api.ts";
import { useSession } from "../session.tsx";
import { ErrorNote, Eyebrow, Field } from "../ui.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** Centered auth card per DESIGN.md ex-auth-form-card. */
function AuthFrame({ eyebrow, title, children }: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="text-3xl text-ink tracking-[-0.03em]">{title}</h1>
        </div>
        <Card>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}

export function SetupScreen() {
  const { refresh } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.signUp({ name, email, password });
      await refresh();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <AuthFrame eyebrow="First run" title="Create the admin">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-mute">
          This account becomes the administrator, then signup closes for good.
        </p>
        <Field label="Name" htmlFor="setup-name">
          <Input id="setup-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Email" htmlFor="setup-email">
          <Input id="setup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" hint="At least 8 characters." htmlFor="setup-password">
          <Input id="setup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Creating..." : "Create admin account"}
        </Button>
      </form>
    </AuthFrame>
  );
}

export function SignInScreen() {
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.signIn({ email, password });
      await refresh();
    } catch (err) {
      // Check the status, not the message: better-auth sends its own message
      // body, so the previous string match never fired.
      setError(
        err instanceof ApiError && err.status === 401
          ? new Error("wrong email or password")
          : err
      );
      setBusy(false);
    }
  }

  return (
    <AuthFrame eyebrow="OpenCMS" title="Sign in">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" htmlFor="signin-email">
          <Input id="signin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="signin-password">
          <Input id="signin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </AuthFrame>
  );
}
