import { cn } from "./cn";

export interface ReferenceAssetFrameProps {
  /** Authorized delivery URL for the asset (a route handler, never a raw key). */
  src: string;
  /** Accessible description, e.g. "Rosa — Front portrait". */
  alt: string;
  /** Caption shown under the image (the view label). */
  caption?: string;
  /** Reserve the correct aspect so the grid never shifts as images load. */
  aspect?: "portrait" | "landscape";
  className?: string;
}

/**
 * A calm, framed image tile for a character reference or candidate. The aspect
 * ratio is RESERVED up front (`aspect-[3/4]` / `aspect-[4/3]`) so a loading grid
 * never shifts (`docs/04-frontend/mobile-ux.md` — no layout shift). Uses a plain
 * `<img>` because assets are served privately through authorized route handlers,
 * not the public image optimiser. Presentational Server Component.
 */
export function ReferenceAssetFrame({
  src,
  alt,
  caption,
  aspect = "portrait",
  className,
}: ReferenceAssetFrameProps) {
  return (
    <figure className={cn("flex flex-col gap-1.5", className)}>
      <div
        className={cn(
          "overflow-hidden rounded-xl border border-border bg-surface shadow-sm",
          aspect === "portrait" ? "aspect-[3/4]" : "aspect-[4/3]",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- private authorized delivery, not the public optimiser */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>
      {caption ? (
        <figcaption className="font-sans text-xs text-ink-muted">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
