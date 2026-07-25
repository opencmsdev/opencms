import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, type ContentTypeDef, type Entry, type FieldDef } from "../api.ts";
import {
  ConfirmButton,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  SimpleSelect,
  StatusDot,
} from "../ui.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const PAGE_SIZE = 25;

export function EntriesScreen() {
  const { type } = useParams<{ type: string }>();
  const [params, setParams] = useSearchParams();
  const [def, setDef] = useState<ContentTypeDef | null>(null);
  const [result, setResult] = useState<{ items: Entry[]; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const status = params.get("status") ?? "all";
  const search = params.get("q") ?? "";
  const page = Math.max(0, Number(params.get("page") ?? "0") || 0);

  const load = useCallback(() => {
    if (!type) return;
    const q = new URLSearchParams();
    q.set("sort", "updatedAt:desc");
    q.set("limit", String(PAGE_SIZE));
    q.set("offset", String(page * PAGE_SIZE));
    if (status === "draft" || status === "published") q.set("status", status);
    api.listEntries(type, q).then(setResult, setError);
  }, [type, status, page]);

  useEffect(() => {
    if (!type) return;
    api.getType(type).then(setDef, setError);
  }, [type]);
  useEffect(load, [load]);

  // Client-side slug/title narrowing on the current page; server-side search
  // by field arrives with a dedicated filter UI later.
  const items = useMemo(() => {
    if (!result) return [];
    if (!search.trim()) return result.items;
    const needle = search.trim().toLowerCase();
    return result.items.filter((e) => {
      const title = firstTextValue(def, e);
      return e.slug.includes(needle) || title.toLowerCase().includes(needle);
    });
  }, [result, search, def]);

  if (!type) return null;
  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Content"
        title={def?.label ?? type}
        actions={
          <Button asChild>
            <Link to={`/content/${type}/new`}>New entry</Link>
          </Button>
        }
      />

      <div className="flex items-center gap-3">
        <SimpleSelect
          ariaLabel="Filter by status"
          className="max-w-40"
          value={status}
          onValueChange={(v) => {
            const next = new URLSearchParams(params);
            if (v === "all") next.delete("status");
            else next.set("status", v);
            next.delete("page");
            setParams(next);
          }}
          options={[
            { value: "all", label: "all statuses" },
            { value: "draft", label: "draft" },
            { value: "published", label: "published" },
          ]}
        />
        <Input
          placeholder="Filter by slug or title..."
          value={search}
          onChange={(e) => {
            const next = new URLSearchParams(params);
            if (e.target.value) next.set("q", e.target.value);
            else next.delete("q");
            setParams(next, { replace: true });
          }}
          className="max-w-xs"
        />
        <span className="text-xs text-mute font-mono ml-auto">
          {result ? `${result.total} total` : ""}
        </span>
      </div>

      <ErrorNote error={error} />

      {result && result.total === 0 ? (
        <EmptyState title="No entries yet">Write the first {def?.label?.toLowerCase() ?? type}.</EmptyState>
      ) : (
        <Card className="py-0 gap-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="th-mono">Title</TableHead>
                <TableHead className="th-mono">Slug</TableHead>
                <TableHead className="th-mono">Status</TableHead>
                <TableHead className="th-mono">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-ink">
                    <Link to={`/content/${type}/${e.id}`} className="block">
                      {firstTextValue(def, e) || <span className="text-mute">untitled</span>}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-mute">{e.slug}</TableCell>
                  <TableCell>
                    <StatusDot status={e.status} />
                  </TableCell>
                  <TableCell className="text-mute text-xs">
                    {new Date(e.updatedAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {pages > 1 ? (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("page", String(page - 1));
              setParams(next);
            }}
          >
            Previous
          </Button>
          <span className="text-xs font-mono text-mute">
            page {page + 1} / {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pages}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("page", String(page + 1));
              setParams(next);
            }}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function firstTextValue(def: ContentTypeDef | null, e: Entry): string {
  const firstText = def?.fields.find((f) => f.kind === "text");
  const v = firstText ? e.data[firstText.name] : undefined;
  return typeof v === "string" ? v : "";
}

// Entry editor ---------------------------------------------------------------

type DraftValues = Record<string, string | boolean>;

function toDraftValues(def: ContentTypeDef, data: Record<string, unknown>): DraftValues {
  const values: DraftValues = {};
  for (const f of def.fields) {
    const v = data[f.name];
    if (f.kind === "boolean") values[f.name] = v === true;
    else if (f.kind === "json") values[f.name] = v === undefined || v === null ? "" : JSON.stringify(v, null, 2);
    else if (f.kind === "number") values[f.name] = v === undefined || v === null ? "" : String(v);
    else values[f.name] = typeof v === "string" ? v : "";
  }
  return values;
}

function fromDraftValues(def: ContentTypeDef, values: DraftValues): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of def.fields) {
    const v = values[f.name];
    if (f.kind === "boolean") {
      data[f.name] = v === true;
      continue;
    }
    const raw = typeof v === "string" ? v : "";
    if (raw === "") continue; // absent: defaults apply, optionals stay unset
    if (f.kind === "number") data[f.name] = Number(raw);
    else if (f.kind === "json") {
      try {
        data[f.name] = JSON.parse(raw);
      } catch {
        data[f.name] = raw; // let the server report the validation error
      }
    } else if (f.kind === "date") {
      const d = new Date(raw);
      data[f.name] = Number.isNaN(d.getTime()) ? raw : d.toISOString();
    } else data[f.name] = raw;
  }
  return data;
}

function FieldInput({ field, value, onChange, id }: {
  field: FieldDef;
  value: string | boolean;
  onChange: (v: string | boolean) => void;
  id?: string;
}) {
  switch (field.kind) {
    case "boolean":
      return (
        <Label className="flex items-center gap-2 cursor-pointer py-2 font-normal">
          {/* A Radix checkbox renders a <button>, which a wrapping <label> cannot
              name, so the accessible name has to be set explicitly. */}
          <Checkbox
            id={id}
            aria-label={field.label ?? field.name}
            checked={value === true}
            onCheckedChange={(v) => onChange(v === true)}
          />
          <span className="text-sm">{field.label ?? field.name}</span>
        </Label>
      );
    case "richtext":
      return (
        <Textarea
          id={id}
          className="min-h-48"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          name={field.name}
        />
      );
    case "json":
      return (
        <Textarea
          id={id}
          className="min-h-32 font-mono text-xs"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          name={field.name}
        />
      );
    case "select":
      return (
        <SimpleSelect
          id={id}
          ariaLabel={field.label ?? field.name}
          value={typeof value === "string" ? value : ""}
          onValueChange={onChange}
          options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
          placeholder="(unset)"
        />
      );
    case "number":
      return (
        <Input
          id={id}
          type="number"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          name={field.name}
        />
      );
    case "date":
      return (
        <Input
          id={id}
          type="datetime-local"
          value={typeof value === "string" ? value.slice(0, 16) : ""}
          onChange={(e) => onChange(e.target.value)}
          name={field.name}
        />
      );
    default:
      // text, reference (entry id), media (storage key, real picker in M5)
      return (
        <Input
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          name={field.name}
          placeholder={field.kind === "reference" ? `id of a ${field.ref ?? "referenced"} entry` : undefined}
        />
      );
  }
}

export function EntryEditorScreen() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const isNew = id === undefined;
  const navigate = useNavigate();

  const [def, setDef] = useState<ContentTypeDef | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [values, setValues] = useState<DraftValues>({});
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!type) return;
    api.getType(type).then((d) => {
      setDef(d);
      if (isNew) setValues(toDraftValues(d, {}));
    }, setError);
  }, [type, isNew]);

  useEffect(() => {
    if (!type || isNew || !def) return;
    api.getEntry(type, id).then((e) => {
      setEntry(e);
      setSlug(e.slug);
      setValues(toDraftValues(def, e.data));
    }, setError);
  }, [type, id, isNew, def]);

  async function save(statusOverride?: "draft" | "published") {
    if (!type || !def) return;
    setBusy(true);
    setError(null);
    const data = fromDraftValues(def, values);
    try {
      if (isNew) {
        const created = await api.createEntry(type, {
          ...(slug.trim() ? { slug: slug.trim() } : {}),
          ...(statusOverride ? { status: statusOverride } : {}),
          data,
        });
        navigate(`/content/${type}/${created.id}`);
      } else {
        const updated = await api.updateEntry(type, id, {
          ...(slug.trim() && slug.trim() !== entry?.slug ? { slug: slug.trim() } : {}),
          ...(statusOverride ? { status: statusOverride } : {}),
          data,
        });
        setEntry(updated);
        setSlug(updated.slug);
        setValues(toDraftValues(def, updated.data));
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function togglePublish() {
    if (!type || isNew || !entry) return;
    setBusy(true);
    setError(null);
    try {
      const updated =
        entry.status === "published"
          ? await api.unpublishEntry(type, entry.id)
          : await api.publishEntry(type, entry.id);
      setEntry(updated);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!type || isNew || !entry) return;
    setBusy(true);
    try {
      await api.deleteEntry(type, entry.id);
      navigate(`/content/${type}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  if (!def) return <ErrorNote error={error} />;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="eyebrow">{def.label}</div>
          <h1 className="text-3xl text-ink tracking-[-0.03em]">
            {isNew ? "New entry" : firstTextValue(def, { ...entry, data: entry?.data ?? {} } as Entry) || "Edit entry"}
          </h1>
          {entry ? (
            <div className="mt-2 flex items-center gap-3 text-xs text-mute">
              <StatusDot status={entry.status} />
              {entry.publishedAt ? <span>published {new Date(entry.publishedAt).toLocaleString()}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="flex gap-2 shrink-0">
          {!isNew && entry ? (
            <>
              <ConfirmButton
                label="Delete"
                title="Delete this entry?"
                description="This cannot be undone."
                onConfirm={remove}
                disabled={busy}
              />
              <Button variant="outline" onClick={togglePublish} disabled={busy} data-testid="toggle-publish">
                {entry.status === "published" ? "Unpublish" : "Publish"}
              </Button>
            </>
          ) : null}
          {isNew ? (
            <Button variant="outline" onClick={() => save("published")} disabled={busy}>
              Save + publish
            </Button>
          ) : null}
          <Button onClick={() => save()} disabled={busy} data-testid="save-entry">
            {busy ? "Saving..." : isNew ? "Save draft" : "Save"}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-5">
          <Field label="Slug" hint={isNew ? "Leave empty to derive from the first text field." : undefined} htmlFor="entry-slug">
            <Input id="entry-slug" value={slug} onChange={(e) => setSlug(e.target.value)} className="font-mono text-xs" />
          </Field>
          {def.fields.map((f) => (
            <div key={f.name}>
              {f.kind === "boolean" ? (
                <FieldInput id={`entry-field-${f.name}`} field={f} value={values[f.name] ?? false} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
              ) : (
                <Field
                  label={`${f.label ?? f.name}${f.required ? " *" : ""}`}
                  hint={f.kind === "media" ? "Storage key; the media library arrives in M5." : undefined}
                  htmlFor={`entry-field-${f.name}`}
                >
                  <FieldInput
                    id={`entry-field-${f.name}`}
                    field={f}
                    value={values[f.name] ?? ""}
                    onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))}
                  />
                </Field>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <ErrorNote error={error} />
    </div>
  );
}
