import { MediaBrowser } from "../components/media.tsx";
import { PageHeader } from "../ui.tsx";

/**
 * The media library: everything in object storage, for editors and admins
 * alike. Media is content, so it sits in the editors' domain, not the admin
 * surface. Uploading here and picking from an entry's media field are the
 * same library.
 */
export function MediaScreen() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Library" title="Media" />
      <p className="text-sm text-mute max-w-xl">
        Files live in the configured storage bucket. A media field stores the
        file's key; anyone can read a file back through its public URL.
      </p>
      <MediaBrowser />
    </div>
  );
}
