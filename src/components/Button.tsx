import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight. `primary` is the single warm accent action per surface. */
  variant?: ButtonVariant;
  /** `md` (44px min target) or `lg` for primary calls to action. */
  size?: ButtonSize;
  /** Stretch to the width of the container — common on mobile. */
  fullWidth?: boolean;
  /** Optional leading element (e.g. an icon). Decorative only. */
  leading?: ReactNode;
}

const base = cn(
  "inline-flex items-center justify-center gap-2 select-none",
  "min-h-[var(--touch-min)] rounded-lg font-sans font-medium",
  "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
  "disabled:cursor-not-allowed disabled:opacity-55",
);

const variants: Record<ButtonVariant, string> = {
  primary: cn(
    "bg-accent-strong text-on-accent shadow-sm",
    "hover:bg-accent-hover active:bg-accent-hover",
  ),
  secondary: cn(
    "bg-surface text-ink border border-border-strong",
    "hover:bg-accent-soft active:bg-accent-soft",
  ),
  ghost: cn(
    "bg-transparent text-accent",
    "hover:bg-accent-soft active:bg-accent-soft",
  ),
  danger: cn(
    "bg-danger text-on-danger shadow-sm",
    "hover:brightness-95 active:brightness-95",
  ),
};

const sizes: Record<ButtonSize, string> = {
  md: "px-5 text-base",
  lg: "px-6 py-1 text-lg",
};

/**
 * The button's visual classes, exported so a navigational element (a Next.js
 * `<Link>`, which renders an `<a>`) can look like a button WITHOUT nesting a
 * `<button>` inside an `<a>` (invalid, interactive-in-interactive HTML). Use
 * this for links that act as calls to action; use `<Button>` for real actions.
 */
export function buttonClassName(options?: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}): string {
  const {
    variant = "primary",
    size = "md",
    fullWidth = false,
    className,
  } = options ?? {};
  return cn(
    base,
    variants[variant],
    sizes[size],
    fullWidth && "w-full",
    className,
  );
}

/**
 * The core action control. Universal component — renders on the server, and
 * works with client handlers when composed inside a Client Component.
 */
export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  leading,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName({ variant, size, fullWidth, className })}
      {...props}
    >
      {leading ? (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      {children}
    </button>
  );
}
