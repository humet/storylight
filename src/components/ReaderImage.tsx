import { cn } from "./cn";

export interface ReaderImageProps {
  /** The planned caption / concise alt text (`story-reader.md`, `accessibility.md`). */
  caption: string;
  /** Reserve the correct aspect so the reader never shifts (`story-reader.md`). */
  aspect?: "portrait" | "landscape" | "square";
  className?: string;
}

/**
 * An inline reader illustration slot. In M7 no images are generated (M9), so the
 * slot renders a RESERVED-ASPECT placeholder — the aspect ratio is fixed up front
 * so text never reflows when an image later arrives (`docs/04-frontend/story-reader.md`
 * "Reserve aspect ratio before loading"; "Avoid layout shift"). The decorative
 * placeholder is hidden from assistive tech; the caption stays a real, readable
 * figcaption so the illustration's meaning is in the reading order
 * (`accessibility.md`: pending images do not disrupt reading order).
 */
export function ReaderImage({
  caption,
  aspect = "landscape",
  className,
}: ReaderImageProps) {
  const aspectClass =
    aspect === "portrait"
      ? "aspect-[3/4]"
      : aspect === "square"
        ? "aspect-square"
        : "aspect-[4/3]";

  return (
    <figure className={cn("my-6 flex flex-col gap-2", className)}>
      <div
        aria-hidden
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-2xl",
          "border border-border bg-accent-soft",
          aspectClass,
        )}
      >
        <span className="font-sans text-sm text-ink-muted">
          Illustration coming soon
        </span>
      </div>
      <figcaption className="font-sans text-sm text-ink-muted text-pretty">
        {caption}
      </figcaption>
    </figure>
  );
}
