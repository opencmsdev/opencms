import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, type ContentTypeDef, type FieldDef } from "../api.ts";
import { ConfirmButton, EmptyState, ErrorNote, Eyebrow, Field, PageHeader, SimpleSelect } from "../ui.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const KINDS: FieldDef["kind"][] = [
  "text",
  "richtext",
  "number",
  "boolean",
  "date",
  "select",
  "json",
  "reference",
  "media",
];

export function TypesScreen() {
  const [types, setTypes] = useState<ContentTypeDef[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.listTypes().then((r) => setTypes(r.items), setError);
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Schema"
        title="Content types"
        actions={
          <Button asChild>
            <Link to="/types/new">New type</Link>
          </Button>
        }
      />
      <ErrorNote error={error} />
      {types && types.length === 0 ? (
        <EmptyState title="No content types yet">
          A content type defines a shape of content: an article, a page, a product. Create the
          first one to start writing entries.
        </EmptyState>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(types ?? []).map((t) => (
          <Link key={t.name} to={`/types/${t.name}`}>
            <Card className="hover:bg-canvas-soft transition-colors">
              <CardContent className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-lg text-ink tracking-[-0.02em]">{t.label}</span>
                  <span className="font-mono text-xs text-mute">{t.name}</span>
                </div>
                <div className="text-sm text-mute">
                  {t.fields.length} field{t.fields.length === 1 ? "" : "s"}
                  {t.description ? ` · ${t.description}` : ""}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

interface DraftField extends FieldDef {
  /** Local list key, stable across renames. */
  _key: number;
  /** options edited as comma-separated text */
  _options?: string;
  _default?: string;
}

function toDraft(f: FieldDef, key: number): DraftField {
  return {
    ...f,
    _key: key,
    _options: f.options?.join(", ") ?? "",
    _default: f.default === undefined ? "" : typeof f.default === "string" ? f.default : JSON.stringify(f.default),
  };
}

function fromDraft(d: DraftField): FieldDef {
  const f: FieldDef = { name: d.name.trim(), kind: d.kind };
  if (d.label?.trim()) f.label = d.label.trim();
  if (d.required) f.required = true;
  if (d.unique) f.unique = true;
  if (d.indexed) f.indexed = true;
  if (d.kind === "select") {
    const opts = (d._options ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (opts.length) f.options = opts;
  }
  if (d.kind === "reference" && d.ref?.trim()) f.ref = d.ref.trim();
  if (d._default?.trim()) {
    const raw = d._default.trim();
    if (d.kind === "number") f.default = Number(raw);
    else if (d.kind === "boolean") f.default = raw === "true";
    else if (d.kind === "json") {
      try {
        f.default = JSON.parse(raw);
      } catch {
        f.default = raw;
      }
    } else f.default = raw;
  }
  return f;
}

export function TypeEditorScreen() {
  const { name } = useParams();
  const isNew = name === undefined;
  const navigate = useNavigate();

  const [typeName, setTypeName] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<DraftField[]>([]);
  const [loaded, setLoaded] = useState(isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [nextKey, setNextKey] = useState(0);

  useEffect(() => {
    if (isNew) return;
    api.getType(name).then((t) => {
      setTypeName(t.name);
      setLabel(t.label);
      setDescription(t.description ?? "");
      setFields(t.fields.map(toDraft));
      setNextKey(t.fields.length);
      setLoaded(true);
    }, setError);
  }, [isNew, name]);

  function addField() {
    setFields((fs) => [...fs, { _key: nextKey, name: "", kind: "text", _options: "", _default: "" }]);
    setNextKey((k) => k + 1);
  }

  function patchField(key: number, patch: Partial<DraftField>) {
    setFields((fs) => fs.map((f) => (f._key === key ? { ...f, ...patch } : f)));
  }

  function removeField(key: number) {
    setFields((fs) => fs.filter((f) => f._key !== key));
  }

  function moveField(key: number, dir: -1 | 1) {
    setFields((fs) => {
      const i = fs.findIndex((f) => f._key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= fs.length) return fs;
      const next = [...fs];
      const [item] = next.splice(i, 1);
      next.splice(j, 0, item!);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    const def = {
      name: typeName.trim(),
      label: label.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      fields: fields.map(fromDraft),
    };
    try {
      if (isNew) await api.createType(def);
      else await api.updateType(name, def);
      navigate("/types");
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  async function remove() {
    if (isNew) return;
    setBusy(true);
    try {
      await api.deleteType(name!);
      navigate("/types");
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  if (!loaded) return <ErrorNote error={error} />;

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        eyebrow="Schema"
        title={isNew ? "New content type" : label || typeName}
        actions={
          <>
            {!isNew ? (
              <ConfirmButton
                label="Delete"
                title={`Delete "${typeName}"?`}
                description="The definition goes away; its entries stay in the database."
                onConfirm={remove}
                disabled={busy}
              />
            ) : null}
            <Button onClick={save} disabled={busy} data-testid="save-type">
              {busy ? "Saving..." : "Save"}
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Machine name" hint="Lowercase, stable, used in URLs and the API." htmlFor="type-name">
              <Input
                id="type-name"
                value={typeName}
                onChange={(e) => setTypeName(e.target.value)}
                disabled={!isNew}
                placeholder="article"
              />
            </Field>
            <Field label="Label" htmlFor="type-label">
              <Input id="type-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Article" />
            </Field>
          </div>
          <Field label="Description" htmlFor="type-description">
            <Input id="type-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Eyebrow>Fields</Eyebrow>
          <Button variant="outline" size="sm" onClick={addField} data-testid="add-field">
            Add field
          </Button>
        </div>
        {fields.map((f, i) => (
          <Card key={f._key} data-testid={`field-${i}`}>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Field name" htmlFor={`field-name-${i}`}>
                  <Input
                    id={`field-name-${i}`}
                    value={f.name}
                    onChange={(e) => patchField(f._key, { name: e.target.value })}
                    placeholder="title"
                  />
                </Field>
                <Field label="Kind" htmlFor={`field-kind-${i}`}>
                  <SimpleSelect
                    id={`field-kind-${i}`}
                    ariaLabel="Kind"
                    value={f.kind}
                    onValueChange={(v) => patchField(f._key, { kind: v as FieldDef["kind"] })}
                    options={KINDS.map((k) => ({ value: k, label: k }))}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Label" htmlFor={`field-label-${i}`}>
                  <Input
                    id={`field-label-${i}`}
                    value={f.label ?? ""}
                    onChange={(e) => patchField(f._key, { label: e.target.value })}
                  />
                </Field>
                {f.kind === "select" ? (
                  <Field label="Options" hint="Comma-separated." htmlFor={`field-options-${i}`}>
                    <Input
                      id={`field-options-${i}`}
                      value={f._options ?? ""}
                      onChange={(e) => patchField(f._key, { _options: e.target.value })}
                      placeholder="news, opinion, review"
                    />
                  </Field>
                ) : f.kind === "reference" ? (
                  <Field label="References type" htmlFor={`field-ref-${i}`}>
                    <Input
                      id={`field-ref-${i}`}
                      value={f.ref ?? ""}
                      onChange={(e) => patchField(f._key, { ref: e.target.value })}
                      placeholder="author"
                    />
                  </Field>
                ) : (
                  <Field label="Default" hint="Applied when the field is absent on create." htmlFor={`field-default-${i}`}>
                    <Input
                      id={`field-default-${i}`}
                      value={f._default ?? ""}
                      onChange={(e) => patchField(f._key, { _default: e.target.value })}
                    />
                  </Field>
                )}
              </div>
              <div className="flex items-center justify-between">
                <div className="flex gap-5 text-sm">
                  {(["required", "unique", "indexed"] as const).map((flag) => (
                    <Label key={flag} className="flex items-center gap-2 cursor-pointer font-normal">
                      <Checkbox
                        checked={Boolean(f[flag])}
                        onCheckedChange={(v) => patchField(f._key, { [flag]: v === true })}
                        aria-label={flag}
                      />
                      <span className="font-mono text-xs uppercase tracking-wider text-mute">{flag}</span>
                    </Label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => moveField(f._key, -1)} disabled={i === 0} aria-label="Move up">
                    ↑
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => moveField(f._key, 1)} disabled={i === fields.length - 1} aria-label="Move down">
                    ↓
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => removeField(f._key)}>
                    Remove
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {fields.length === 0 ? (
          <EmptyState title="No fields yet">Add the first field, e.g. a required text field named title.</EmptyState>
        ) : null}
      </div>

      <ErrorNote error={error} />
    </div>
  );
}
