/**
 * Minimal class-name joiner. Filters falsy values and joins with a space.
 * A local abstraction rather than a dependency (see AGENTS.md "Do not").
 */
export type ClassValue = string | number | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
