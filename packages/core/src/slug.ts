/** Turn arbitrary text into a URL-safe slug. */
export function slugify(input: string): string {
  const s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    // Truncate first, then trim: slicing after the trim can reintroduce a
    // trailing hyphen and produce a slug that fails isValidSlug.
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
  return s.length > 0 ? s : "entry";
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s) && s.length <= 120;
}
