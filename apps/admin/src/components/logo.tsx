/**
 * The OpenCMS mark.
 *
 * Drawn on a 256 grid: a frame ring 40 thick, broken by a 21 wide slot at the
 * centre of every side, around a free-floating core ring 34 thick with a 78
 * aperture. Four tabs docking into one socket.
 *
 * It is a single even-odd path, so the whole mark takes one `currentColor`
 * fill, scales to any size and needs no raster asset. The geometry is fixed and
 * matches the Figma source (page `04 Brand`); the icon files in `public/` are
 * generated from this same path data. Do not redraw it by hand.
 */

const MARK_PATH =
  "M40 202C40 209.732 46.268 216 54 216L117.5 216L117.5 256L46 256C20.5949 256 0 235.4051 0 210L0 138.5L40 138.5L40 202Z" +
  "M256 210C256 235.4051 235.4051 256 210 256L138.5 256L138.5 216L202 216C209.732 216 216 209.732 216 202L216 138.5L256 138.5L256 210Z" +
  "M210 0C235.4051 0 256 20.5949 256 46L256 117.5L216 117.5L216 54C216 46.268 209.732 40 202 40L138.5 40L138.5 0L210 0Z" +
  "M117.5 40L54 40C46.268 40 40 46.268 40 54L40 117.5L0 117.5L0 46C0 20.5949 20.5949 0 46 0L117.5 0L117.5 40Z" +
  "M173 55C188.464 55 201 67.536 201 83L201 173C201 188.464 188.464 201 173 201L83 201C67.536 201 55 188.464 55 173L55 83C55 67.536 67.536 55 83 55L173 55Z" +
  "M104 89C95.7157 89 89 95.7157 89 104L89 152C89 160.2843 95.7157 167 104 167L152 167C160.2843 167 167 160.2843 167 152L167 104C167 95.7157 160.2843 89 152 89L104 89Z";

type LogoMarkProps = {
  /** Rendered edge length in px. The mark is square. */
  size?: number;
  className?: string;
  /**
   * Give the mark an accessible name. Leave unset inside a lockup or next to a
   * visible "OpenCMS", where the mark is decorative and naming it would make a
   * screen reader announce the brand twice.
   */
  title?: string;
};

export function LogoMark({ size = 24, className, title }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path fillRule="evenodd" fill="currentColor" d={MARK_PATH} />
    </svg>
  );
}

type LogoLockupProps = {
  /** Edge length of the mark in px. The wordmark is sized independently. */
  size?: number;
  className?: string;
  /** Overrides on the wordmark, e.g. a different size. */
  textClassName?: string;
};

/**
 * Mark plus wordmark. `CMS` drops to `text-mute` so the name reads as one word
 * with a built-in hierarchy, matching the Figma lockup.
 */
export function LogoLockup({
  size = 20,
  className,
  textClassName,
}: LogoLockupProps) {
  return (
    <span
      className={`inline-flex items-center gap-2.5 text-ink${className ? ` ${className}` : ""}`}
    >
      <LogoMark size={size} />
      <span
        className={`text-lg tracking-[-0.02em]${textClassName ? ` ${textClassName}` : ""}`}
      >
        Open<span className="text-mute">CMS</span>
      </span>
    </span>
  );
}
