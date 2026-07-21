import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, type AdminUser } from "../api.ts";
import { useSession } from "../session.tsx";
import { ErrorNote, Field, PageHeader, SimpleSelect } from "../ui.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function UsersScreen() {
  const { user: me } = useSession();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    api.listUsers().then((r) => setUsers(r.users), setError);
  }, []);
  useEffect(load, [load]);

  async function changeRole(u: AdminUser, role: "admin" | "editor") {
    setError(null);
    try {
      await api.setRole(u.id, role);
      load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        eyebrow="Access"
        title="Users"
        actions={
          <Button onClick={() => setShowForm((v) => !v)} data-testid="new-user">
            {showForm ? "Close" : "New user"}
          </Button>
        }
      />

      {showForm ? (
        <NewUserForm
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      ) : null}

      <ErrorNote error={error} />

      <Card className="py-0 gap-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="th-mono">Name</TableHead>
              <TableHead className="th-mono">Email</TableHead>
              <TableHead className="th-mono">Role</TableHead>
              <TableHead className="th-mono">Since</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(users ?? []).map((u) => (
              <TableRow key={u.id}>
                <TableCell className="text-ink">
                  {u.name}
                  {u.id === me?.id ? <span className="text-mute text-xs"> (you)</span> : null}
                </TableCell>
                <TableCell className="text-mute">{u.email}</TableCell>
                <TableCell>
                  {u.id === me?.id ? (
                    <span className="font-mono text-xs">{u.role ?? "editor"}</span>
                  ) : (
                    <SimpleSelect
                      ariaLabel={`Role for ${u.email}`}
                      className="max-w-32"
                      value={u.role ?? "editor"}
                      onValueChange={(v) => changeRole(u, v as "admin" | "editor")}
                      options={[
                        { value: "admin", label: "admin" },
                        { value: "editor", label: "editor" },
                      ]}
                    />
                  )}
                </TableCell>
                <TableCell className="text-mute text-xs">
                  {new Date(u.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function NewUserForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "editor">("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createUser({ name, email, password, role });
      onCreated();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" htmlFor="new-user-name">
              <Input id="new-user-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Email" htmlFor="new-user-email">
              <Input id="new-user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Password" hint="Share it over a safe channel; they can change it later." htmlFor="new-user-password">
              <Input id="new-user-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </Field>
            <Field label="Role" hint="Editors manage content; admins also manage schema and access.">
              <SimpleSelect
                ariaLabel="Role"
                value={role}
                onValueChange={(v) => setRole(v as "admin" | "editor")}
                options={[
                  { value: "editor", label: "editor" },
                  { value: "admin", label: "admin" },
                ]}
              />
            </Field>
          </div>
          <ErrorNote error={error} />
          <Button type="submit" disabled={busy} data-testid="create-user">
            {busy ? "Creating..." : "Create user"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
