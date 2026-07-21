import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, type ApiKeySummary } from "../api.ts";
import { ConfirmButton, ErrorNote, Eyebrow, Field, PageHeader, SimpleSelect } from "../ui.tsx";
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

export function KeysScreen() {
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [showForm, setShowForm] = useState(false);
  const [minted, setMinted] = useState<string | null>(null);

  const load = useCallback(() => {
    api.listKeys().then((r) => setKeys(r.apiKeys), setError);
  }, []);
  useEffect(load, [load]);

  async function revoke(k: ApiKeySummary) {
    setError(null);
    try {
      await api.deleteKey(k.id);
      load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        eyebrow="Access"
        title="API keys"
        actions={
          <Button onClick={() => setShowForm((v) => !v)} data-testid="new-key">
            {showForm ? "Close" : "New key"}
          </Button>
        }
      />

      <p className="text-sm text-mute max-w-xl">
        Machine access for scripts, CI and agents. Send the key in the{" "}
        <span className="font-mono text-xs">x-api-key</span> header. Keys carry a role: editor keys
        manage content, admin keys also manage schema.
      </p>

      {showForm ? (
        <NewKeyForm
          onCreated={(key) => {
            setShowForm(false);
            setMinted(key);
            load();
          }}
        />
      ) : null}

      {minted ? (
        <Card className="border-breeze/40">
          <CardContent className="space-y-2">
            <Eyebrow>Copy it now</Eyebrow>
            <p className="text-sm text-mute">This key is shown once and never again.</p>
            <code
              className="block font-mono text-xs text-ink bg-secondary border border-border rounded-lg p-3 break-all"
              data-testid="minted-key"
            >
              {minted}
            </code>
            <Button variant="outline" size="sm" onClick={() => setMinted(null)}>
              Done, I copied it
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <ErrorNote error={error} />

      <Card className="py-0 gap-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="th-mono">Name</TableHead>
              <TableHead className="th-mono">Key</TableHead>
              <TableHead className="th-mono">Role</TableHead>
              <TableHead className="th-mono">Last used</TableHead>
              <TableHead className="th-mono"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(keys ?? []).map((k) => (
              <TableRow key={k.id}>
                <TableCell className="text-ink">{k.name ?? <span className="text-mute">unnamed</span>}</TableCell>
                <TableCell className="font-mono text-xs text-mute">{k.start ?? "?"}...</TableCell>
                <TableCell className="font-mono text-xs">{k.metadata?.role ?? "editor"}</TableCell>
                <TableCell className="text-mute text-xs">
                  {k.lastRequest ? new Date(k.lastRequest).toLocaleString() : "never"}
                </TableCell>
                <TableCell className="text-right">
                  <ConfirmButton
                    size="sm"
                    label="Revoke"
                    title={`Revoke "${k.name ?? k.id}"?`}
                    description="Clients using this key stop working immediately."
                    onConfirm={() => revoke(k)}
                  />
                </TableCell>
              </TableRow>
            ))}
            {keys && keys.length === 0 ? (
              <TableRow>
                <TableCell className="text-mute" colSpan={5}>
                  No API keys yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function NewKeyForm({ onCreated }: { onCreated: (key: string) => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<"admin" | "editor">("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createKey({ name, role });
      onCreated(created.key);
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
            <Field label="Name" hint="What uses this key, e.g. ci, website, agent." htmlFor="key-name">
              <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Role">
              <SimpleSelect
                ariaLabel="Key role"
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
          <Button type="submit" disabled={busy} data-testid="mint-key">
            {busy ? "Minting..." : "Mint key"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
