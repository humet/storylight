import { z } from "zod";

/**
 * Lenient parser for the vision reviewer's JSON verdict.
 *
 * WHY THIS EXISTS: a strict `Output.object` structured-output call on the
 * multimodal review model (`google/gemini-2.5-flash`) is UNRELIABLE — it
 * frequently returns `NoObjectGeneratedError` ("response did not match schema")
 * even when the underlying judgement is fine. Treated as a failure, that
 * silently rejects a perfectly good illustration (observed: images matching at
 * ~98% identity still not approved). Empirically, asking for compact JSON in
 * plain text and parsing it leniently succeeds where `Output.object` fails.
 *
 * This module is PURE (no provider SDK, no IO) so it is unit-testable without a
 * gateway call. It tolerates markdown code fences and surrounding prose by
 * extracting the first balanced JSON object, then validates it against the wire
 * schema. Returns `null` when no valid verdict can be recovered (the caller
 * retries, then fails safe — a verdict is NEVER fabricated).
 */

export const VerdictWireSchema = z.object({
  identityByChild: z.array(
    z.object({
      characterKey: z.string(),
      matches: z.boolean(),
    }),
  ),
  observedCount: z.number().int().min(0),
  outfitConsistent: z.boolean(),
  propConsistent: z.boolean(),
  toneAppropriate: z.boolean(),
  styleConsistent: z.boolean(),
  /**
   * ADR-008 part 3/5: per-companion species verdict. OPTIONAL with a FAIL-SAFE
   * default — when the model omits it (a pre-ADR-008 review, or no companions were
   * asked about) it becomes an empty list; the ADAPTER then maps each EXPECTED
   * companion to `matches:false` if unreported, because a wrong/absent companion
   * species is blocking and must never be fabricated as a pass (rule 7 class).
   */
  companionsByKey: z
    .array(
      z.object({
        companionKey: z.string(),
        matches: z.boolean(),
      }),
    )
    .optional(),
  /**
   * ADR-008 part 4/5: setting/time-of-day verdict. OPTIONAL with a SAFE default —
   * when absent the setting check is SKIPPED (treated as consistent). This is the
   * safe value for a NON-blocking check: the model is only asked about the setting
   * when one is carried, so an absent field means "nothing to check" (safe absence)
   * rather than a hidden failure. A reported `false` drives a targeted repair.
   */
  settingConsistent: z.boolean().optional(),
  notes: z.string().optional(),
});

export type VerdictWire = z.infer<typeof VerdictWireSchema>;

/** Extract the first balanced `{...}` object from arbitrary model text. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse a reviewer response into a validated {@link VerdictWire}, or `null` if
 * no valid verdict can be recovered from the text.
 */
export function parseVisionVerdict(text: string): VerdictWire | null {
  const json = extractJsonObject(text);
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = VerdictWireSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
