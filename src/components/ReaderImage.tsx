import { cn } from "./cn";

export interface ReaderImageProps {
  /** The planned caption / concise alt text (`story-reader.md`, `accessibility.md`). */
  caption: string;
  /** Reserve the correct aspect so the reader never shifts (`story-reader.md`). */
  aspect?: "portrait" | "landscape" | "square";
  /**
   * The illustration spec id — the authorized delivery route path when approved.
   * Absent renders a pure placeholder (M7 behaviour).
   */
  specId?: string;
  /**
   * The image job state (M9). `pending` paints a calm "Painting this page" slot;
   * `approved` serves the approved original via the authorized route (ADR-007);
   * `failed` (manual review / failure) shows a calm fallback. In every case the
   * caption stays a readable figcaption, so the text is never blocked by image
   * state.
   */
  status?: "pending" | "approved" | "failed";
  className?: string;
}

/**
 * An inline reader illustration slot. The aspect ratio is RESERVED up front so
 * text never reflows when an image arrives (`docs/04-frontend/story-reader.md`
 * "Reserve aspect ratio before loading"; "Avoid layout shift"). An `approved`
 * image is served from the private authorized delivery route (never the Next
 * optimiser, never a raw key); rejected/quarantined images can never reach here
 * (rule 9 — the query only ever reports `approved`/`pending`/`failed`). The caption
 * stays a real figcaption so the illustration's meaning is always in reading order.
 */
export function ReaderImage({
  caption,
  aspect = "landscape",
  specId,
  status = "pending",
  className,
}: ReaderImageProps) {
  const aspectClass =
    aspect === "portrait"
      ? "aspect-[3/4]"
      : aspect === "square"
        ? "aspect-square"
        : "aspect-[4/3]";

  const frameClass = cn(
    "flex items-center justify-center overflow-hidden rounded-2xl",
    "border border-border bg-accent-soft",
    aspectClass,
  );

  return (
    <figure className={cn("my-6 flex flex-col gap-2", className)}>
      {status === "approved" && specId ? (
        <a
          href={`/app/illustrations/${specId}`}
          target="_blank"
          rel="noopener"
          className={cn(frameClass, "block")}
          aria-label={`View illustration full screen: ${caption}`}
        >
          {/* Private authorized delivery — not the Next optimiser. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/app/illustrations/${specId}`}
            alt={caption}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </a>
      ) : status === "failed" ? (
        <div aria-hidden className={frameClass}>
          <span className="font-sans text-sm text-ink-muted">
            This picture is resting for now
          </span>
        </div>
      ) : (
        <div
          aria-hidden
          className={cn(frameClass, "animate-pulse")}
          data-testid="reader-image-pending"
        >
          <span className="font-sans text-sm text-ink-muted">
            Painting this page…
          </span>
        </div>
      )}
      <figcaption className="font-sans text-sm text-ink-muted text-pretty">
        {caption}
      </figcaption>
    </figure>
  );
}
