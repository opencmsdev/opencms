/**
 * The OpenCMS mark and app-icon tile.
 *
 * The mark is drawn on a 256 grid: a frame ring 40 thick, broken by a 21 wide
 * slot at the centre of every side, around a free-floating core ring 34 thick
 * with a 78 aperture. Four tabs docking into one socket.
 *
 * It is a single even-odd path, so the whole mark takes one fill. The geometry
 * is fixed and matches the Figma source (page `04 Brand`); the icon files in
 * `public/` are generated from this same path data. Do not redraw it by hand.
 */

const MARK_PATH =
  "M40 202C40 209.732 46.268 216 54 216L117.5 216L117.5 256L46 256C20.5949 256 0 235.4051 0 210L0 138.5L40 138.5L40 202Z" +
  "M256 210C256 235.4051 235.4051 256 210 256L138.5 256L138.5 216L202 216C209.732 216 216 209.732 216 202L216 138.5L256 138.5L256 210Z" +
  "M210 0C235.4051 0 256 20.5949 256 46L256 117.5L216 117.5L216 54C216 46.268 209.732 40 202 40L138.5 40L138.5 0L210 0Z" +
  "M117.5 40L54 40C46.268 40 40 46.268 40 54L40 117.5L0 117.5L0 46C0 20.5949 20.5949 0 46 0L117.5 0L117.5 40Z" +
  "M173 55C188.464 55 201 67.536 201 83L201 173C201 188.464 188.464 201 173 201L83 201C67.536 201 55 188.464 55 173L55 83C55 67.536 67.536 55 83 55L173 55Z" +
  "M104 89C95.7157 89 89 95.7157 89 104L89 152C89 160.2843 95.7157 167 104 167L152 167C160.2843 167 167 160.2843 167 152L167 104C167 95.7157 160.2843 89 152 89L104 89Z";

/** Brushed-steel ramp, lit from the top left. Matches `Logo / Mark` Style=Metal. */
const STEEL_STOPS: [string, string][] = [
  ["0", "#FFFFFF"],
  ["0.09", "#F0F2F6"],
  ["0.26", "#CBD1DA"],
  ["0.48", "#9AA1AB"],
  ["0.78", "#676D76"],
  ["1", "#676D76"],
];

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

/**
 * The flat mark, filled with `currentColor`.
 *
 * Use this wherever the brand has to be monochrome or inherit its colour:
 * one-colour contexts, anything under about 24 px, print, and any surface where
 * the tile's own dark plate would fight the background.
 */
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

type LogoTileProps = {
  /** Rendered edge length in px. Do not go below 28: the gradients turn to mud. */
  size?: number;
  className?: string;
  title?: string;
  /**
   * SVG paint servers are referenced by id, and ids are document global. Every
   * tile ships identical defs, so two tiles sharing a prefix still render
   * correctly, because the reference resolves to the first match. Pass a
   * distinct prefix when a page needs strictly collision-free ids.
   */
  idPrefix?: string;
};

/**
 * The app-icon tile: rounded plate, brushed-steel mark, contact shadow.
 *
 * This is the primary logo. It carries its own dark plate and fixed colours, so
 * it does not inherit `currentColor` and does not belong on a light surface at
 * small sizes. Below roughly 28 px the gradients and the shadow collapse into a
 * dark blob; reach for `LogoMark` there instead.
 */
export function LogoTile({
  size = 32,
  className,
  title,
  idPrefix = "ocms",
}: LogoTileProps) {
  const steel = `${idPrefix}Steel`;
  const sheen = `${idPrefix}Sheen`;
  const bevel = `${idPrefix}Bevel`;
  const plate = `${idPrefix}Plate`;
  const drop = `${idPrefix}Drop`;
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
      <defs>
        {/* Authored in the mark's own 256 space, inside the scaled group below. */}
        <radialGradient
          id={steel}
          gradientUnits="userSpaceOnUse"
          cx="25.6"
          cy="5.12"
          r="204.8"
        >
          {STEEL_STOPS.map(([offset, color]) => (
            <stop key={offset} offset={offset} stopColor={color} />
          ))}
        </radialGradient>
        <radialGradient
          id={sheen}
          gradientUnits="userSpaceOnUse"
          cx="235.52"
          cy="253.44"
          r="117.76"
        >
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.34" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.095" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <clipPath id={bevel}>
          <path fillRule="evenodd" d={MARK_PATH} />
        </clipPath>
        <radialGradient id={plate} cx="0.5" cy="0.34" r="0.85">
          <stop offset="0" stopColor="#1C1F23" />
          <stop offset="1" stopColor="#0A0A0A" />
        </radialGradient>
        <filter id={drop} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow
            dx="0"
            dy="3"
            stdDeviation="3.3"
            floodColor="#000000"
            floodOpacity="0.55"
          />
        </filter>
      </defs>
      <rect width="256" height="256" rx="56" fill={`url(#${plate})`} />
      <g transform="translate(48 48) scale(0.625)" filter={`url(#${drop})`}>
        <path fillRule="evenodd" fill={`url(#${steel})`} d={MARK_PATH} />
        <path fillRule="evenodd" fill={`url(#${sheen})`} d={MARK_PATH} />
        <path
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity="0.35"
          strokeWidth="3"
          clipPath={`url(#${bevel})`}
          d={MARK_PATH}
        />
      </g>
    </svg>
  );
}

type LogoLockupProps = {
  /** Edge length of the tile in px. The wordmark is sized independently. */
  size?: number;
  className?: string;
  /** Overrides on the wordmark, e.g. a different size. */
  textClassName?: string;
  /** Distinct id prefix, needed only when a page renders several lockups. */
  idPrefix?: string;
};

/**
 * Tile plus wordmark. `CMS` drops to `text-mute` so the name reads as one
 * word with a built-in hierarchy, matching the Figma lockup.
 */
export function LogoLockup({
  size = 28,
  className,
  textClassName,
  idPrefix,
}: LogoLockupProps) {
  return (
    <span
      className={`inline-flex items-center gap-2.5 text-ink${className ? ` ${className}` : ""}`}
    >
      <LogoTile size={size} idPrefix={idPrefix} />
      <span
        className={`text-lg tracking-[-0.02em]${textClassName ? ` ${textClassName}` : ""}`}
      >
        Open<span className="text-mute">CMS</span>
      </span>
    </span>
  );
}
