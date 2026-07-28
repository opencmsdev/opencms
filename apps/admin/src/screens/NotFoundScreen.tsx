import { Link } from "react-router";
import { Eyebrow } from "../ui.tsx";
import { LogoTile } from "@/components/logo";
import { Button } from "@/components/ui/button";

/**
 * Shown for any route the router does not recognise.
 *
 * This replaces a silent redirect to "/". A redirect hides typos and stale
 * bookmarks; inside an authed tool it is better to say the URL is wrong and
 * leave the sidebar in place, so nothing is a dead end.
 *
 * Follows the same shape as the empty state in App.tsx, per DESIGN.md.
 */
export function NotFoundScreen() {
  return (
    <div className="space-y-4 pt-16 text-center">
      <LogoTile size={48} className="mx-auto" />
      <Eyebrow>404</Eyebrow>
      <h1 className="text-4xl text-ink tracking-[-0.04em]">No such screen</h1>
      <p className="text-sm text-mute mx-auto max-w-sm">
        That address is not part of the admin. It may have been renamed, or the
        content type behind it may have been deleted.
      </p>
      <div className="pt-2">
        <Button asChild>
          <Link to="/">Back to content</Link>
        </Button>
      </div>
    </div>
  );
}
