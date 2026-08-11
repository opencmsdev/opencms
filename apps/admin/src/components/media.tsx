import { useCallback, useEffect, useState } from "react";
import { FileText, Image as ImageIcon, UploadCloud } from "lucide-react";
import { formatBytes, useFileUpload } from "@/hooks/use-file-upload";
import { api, type MediaObject } from "../api.ts";
import { ConfirmButton, EmptyState, ErrorNote } from "../ui.tsx";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * The media library surface, shared between the full screen (browse, upload,
 * delete) and the picker dialog an entry's media field opens (browse, upload,
 * select). One component so the two can never drift apart.
 *
 * Intake is ReUI's use-file-upload hook (drag and drop, click to browse,
 * client-side size cap); the server list stays the source of truth, so a
 * file leaves the hook's buffer the moment its upload settles.
 */

const PAGE_SIZE = 30;
const MAX_SIZE = 50 * 1024 * 1024; // matches nothing server-side yet; a sanity cap

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

export function isImageKey(obj: Pick<MediaObject, "key" | "contentType">): boolean {
  if (obj.contentType) return obj.contentType.startsWith("image/");
  return IMAGE_EXT.test(obj.key);
}

export { formatBytes };

/** The filename part of a key, for display: `2026/08/photo-ab12cd34.png` → `photo-ab12cd34.png`. */
function baseName(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1);
}

export function MediaBrowser({ onSelect }: {
  /** When set, each object gets a Select action (the picker); otherwise the
   * browser offers copy + delete (the library screen). */
  onSelect?: (obj: MediaObject) => void;
}) {
  const [objects, setObjects] = useState<MediaObject[] | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const loadFirst = useCallback(() => {
    api.listMedia({ limit: PAGE_SIZE }).then((r) => {
      setObjects(r.objects);
      setCursor(r.cursor);
    }, setError);
  }, []);
  useEffect(loadFirst, [loadFirst]);

  const [
    { isDragging, errors: intakeErrors },
    {
      handleDragEnter,
      handleDragLeave,
      handleDragOver,
      handleDrop,
      openFileDialog,
      getInputProps,
      removeFile,
    },
  ] = useFileUpload({
    multiple: true,
    maxSize: MAX_SIZE,
    onFilesAdded: (added) => {
      setError(null);
      for (const item of added) {
        if (!(item.file instanceof File)) continue;
        setUploading((n) => n + 1);
        api
          .uploadMedia(item.file)
          .then(
            (uploaded) => {
              // Newest first: the fresh upload is what the user came to use.
              setObjects((prev) => [uploaded, ...(prev ?? [])]);
            },
            (err) => setError(err)
          )
          .finally(() => {
            setUploading((n) => n - 1);
            removeFile(item.id); // server list owns it now
          });
      }
    },
  });

  async function loadMore() {
    if (!cursor) return;
    setBusy(true);
    try {
      const r = await api.listMedia({ limit: PAGE_SIZE, cursor });
      setObjects((prev) => [...(prev ?? []), ...r.objects]);
      setCursor(r.cursor);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove(obj: MediaObject) {
    setError(null);
    try {
      await api.deleteMedia(obj.key);
      setObjects((prev) => (prev ?? []).filter((o) => o.key !== obj.key));
    } catch (err) {
      setError(err);
    }
  }

  function copyKey(obj: MediaObject) {
    void navigator.clipboard?.writeText(obj.key);
    setCopied(obj.key);
    setTimeout(() => setCopied((k) => (k === obj.key ? null : k)), 1500);
  }

  return (
    <div className="space-y-4">
      {/* Dropzone (ReUI file-upload pattern, restyled per DESIGN.md) */}
      <div
        className={cn(
          "relative rounded-lg border border-dashed p-6 text-center transition-colors",
          isDragging ? "border-ring bg-canvas-soft" : "border-hairline hover:border-ring/50"
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        data-testid="media-dropzone"
      >
        <input
          {...getInputProps({ "aria-label": "Upload files" })}
          className="sr-only"
          data-testid="media-upload-input"
        />
        <div className="flex flex-col items-center gap-3">
          <div
            className={cn(
              "flex size-12 items-center justify-center rounded-full border border-hairline",
              isDragging ? "bg-canvas-soft" : "bg-canvas"
            )}
          >
            {uploading > 0 ? (
              <Spinner className="size-5 text-mute" />
            ) : (
              <UploadCloud className="size-5 text-mute" aria-hidden />
            )}
          </div>
          <div className="space-y-1">
            <div className="text-sm text-ink">
              {uploading > 0 ? `Uploading ${uploading}...` : "Drag files here"}
            </div>
            <p className="text-xs text-mute">
              Served publicly once uploaded. Up to {formatBytes(MAX_SIZE, 0)} each.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={openFileDialog} data-testid="media-upload">
            Browse files
          </Button>
        </div>
      </div>

      {intakeErrors.length > 0 ? <ErrorNote error={new Error(intakeErrors[0])} /> : null}
      <ErrorNote error={error} />

      {objects && objects.length === 0 && uploading === 0 ? (
        <EmptyState title="No media yet">
          Upload images and files here, then use them from a media field.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(objects ?? []).map((obj) => (
            <li
              key={obj.key}
              className="group overflow-hidden rounded-lg border border-hairline bg-canvas-soft"
              data-testid="media-object"
            >
              <div className="flex aspect-video items-center justify-center overflow-hidden bg-canvas">
                {isImageKey(obj) ? (
                  <img
                    src={api.mediaUrl(obj.key)}
                    alt={baseName(obj.key)}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <FileText className="size-8 text-mute" aria-hidden />
                )}
              </div>
              <div className="space-y-1.5 p-2.5">
                <div className="truncate font-mono text-[11px] text-ink" title={obj.key}>
                  {baseName(obj.key)}
                </div>
                <div className="text-[11px] text-mute">
                  {formatBytes(obj.size, 1)} · {new Date(obj.lastModified).toLocaleDateString()}
                </div>
                <div className="flex gap-1.5 pt-0.5">
                  {onSelect ? (
                    <Button size="sm" onClick={() => onSelect(obj)} data-testid="media-select">
                      Select
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => copyKey(obj)}>
                        {copied === obj.key ? "Copied" : "Copy key"}
                      </Button>
                      <ConfirmButton
                        size="sm"
                        label="Delete"
                        title={`Delete "${baseName(obj.key)}"?`}
                        description="Entries still pointing at this key will show a broken file."
                        onConfirm={() => void remove(obj)}
                      />
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cursor ? (
        <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={busy}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}

/** The media field's picker: a dialog wrapping the same browser in select mode. */
export function MediaPickerDialog({ open, onOpenChange, onSelect }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (obj: MediaObject) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[80vh] w-[min(56rem,calc(100vw-2rem))] sm:max-w-4xl overflow-y-auto"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>Choose media</DialogTitle>
        </DialogHeader>
        <MediaBrowser onSelect={onSelect} />
      </DialogContent>
    </Dialog>
  );
}

/** Small inline preview an entry's media field shows for its current key. */
export function MediaKeyPreview({ mediaKey }: { mediaKey: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [mediaKey]);
  if (!mediaKey) return null;
  return (
    <span className="mt-1.5 flex items-center gap-2 text-xs text-mute">
      {isImageKey({ key: mediaKey }) && !broken ? (
        <img
          src={api.mediaUrl(mediaKey)}
          alt=""
          className="h-10 w-10 rounded-md border border-hairline object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <ImageIcon className="size-4" aria-hidden />
      )}
      <a
        href={api.mediaUrl(mediaKey)}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-[11px] underline-offset-2 hover:underline"
      >
        open file
      </a>
    </span>
  );
}
