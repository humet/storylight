/**
 * Pure JSON helpers for the structured-output pipeline
 * (`docs/03-ai/structured-output.md`).
 *
 * AGENTS.md forbids parsing JSON with regular expressions. `JSON.parse` is the
 * ONLY parser here; {@link extractBalancedJsonObject} is a structural brace/quote
 * SCANNER (not a parser) whose sole job is to locate the first complete top-level
 * `{ … }` span so surrounding prose or ```json fences can be stripped. It never
 * repairs, completes, or invents JSON content — the syntax-repair rung is allowed
 * ONLY when no semantic content must be invented (`structured-output.md`
 * "Repair"). If the object is truncated (never closes), it returns null and the
 * pipeline regenerates rather than guessing.
 */

export type JsonParseResult = { ok: true; value: unknown } | { ok: false };

/** Parse strictly with `JSON.parse`; failures are reported, never thrown. */
export function safeParseJson(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * Locate the first BALANCED top-level JSON object in `text` and return its exact
 * source span (still parsed with `JSON.parse` to guarantee validity). Handles
 * strings and escapes so a `{`/`}` inside a string literal never mis-balances the
 * scan. Returns null when there is no complete object (e.g. truncated output) —
 * the caller then regenerates instead of inventing a closing brace.
 */
export function extractBalancedJsonObject(text: string): JsonParseResult {
  const start = text.indexOf("{");
  if (start === -1) return { ok: false };

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        // Found the matching close of the first object — parse just that span.
        return safeParseJson(text.slice(start, i + 1));
      }
    }
  }

  // Never balanced → the object is incomplete/truncated. Do not guess.
  return { ok: false };
}
