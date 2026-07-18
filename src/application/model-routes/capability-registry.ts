import {
  LANGUAGE_CAPABILITIES,
  type LanguageCapability,
} from "@/domain/model-capability";

/**
 * The Storylight CAPABILITY REGISTRY (`docs/03-ai/models.md`, ADR-004). It layers
 * descriptions + a default REPAIR POLICY onto the closed capability vocabulary in
 * `@/domain/model-capability`. Domain services request a capability; the model
 * registry resolves the concrete route; the pipeline reads the repair policy so a
 * capability can favour regeneration over aggressive repair
 * (`structured-output.md`: "Continuity extraction should favour regeneration").
 */

/**
 * How much repair a capability tolerates before regenerating.
 *  - `full`               initial → syntax repair → one model repair → regenerate.
 *  - `regenerate-favoured` initial → syntax repair → regenerate (skip model repair).
 * Continuity extraction is `regenerate-favoured`.
 */
export type RepairPolicy = "full" | "regenerate-favoured";

export interface CapabilityMeta {
  capability: LanguageCapability;
  description: string;
  repairPolicy: RepairPolicy;
}

const META: Record<LanguageCapability, CapabilityMeta> = {
  "one-off-planning": {
    capability: "one-off-planning",
    description: "Plan a single standalone story before any prose is written.",
    repairPolicy: "full",
  },
  "series-planning": {
    capability: "series-planning",
    description: "Plan a complete series bible before Chapter 1 is written.",
    repairPolicy: "full",
  },
  "chapter-planning": {
    capability: "chapter-planning",
    description: "Plan the next chapter from the series bible and continuity.",
    repairPolicy: "full",
  },
  "chapter-writing": {
    capability: "chapter-writing",
    description: "Write a chapter draft following the supplied chapter plan.",
    repairPolicy: "full",
  },
  "chapter-review": {
    capability: "chapter-review",
    description: "Review a chapter draft against safety and quality checks.",
    repairPolicy: "full",
  },
  "chapter-revision": {
    capability: "chapter-revision",
    description: "Apply required revisions to a reviewed chapter draft.",
    repairPolicy: "full",
  },
  "continuity-extraction": {
    capability: "continuity-extraction",
    description: "Extract a structured continuity change set from a chapter.",
    // Favour regeneration over repair — a partially-invented change set is worse
    // than a clean re-run (`structured-output.md`).
    repairPolicy: "regenerate-favoured",
  },
  "illustration-planning": {
    capability: "illustration-planning",
    description: "Plan chapter illustration specifications.",
    repairPolicy: "full",
  },
  "illustration-review": {
    capability: "illustration-review",
    description: "Review a generated illustration against its specification.",
    repairPolicy: "full",
  },
};

export function getCapabilityMeta(
  capability: LanguageCapability,
): CapabilityMeta {
  return META[capability];
}

export function listLanguageCapabilities(): readonly LanguageCapability[] {
  return LANGUAGE_CAPABILITIES;
}
