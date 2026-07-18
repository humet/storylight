import { z } from "zod";

/**
 * Zod v4 command schemas for the visual-character flow — the runtime boundary
 * for the appearance UI (AGENTS.md: "Zod v4 at runtime boundaries"). Everything
 * crossing from a Server Action or route param into the application layer is
 * parsed here before any repository, storage, or model call runs.
 */

/** Request N candidate reference sets for a character. */
export const RequestCandidatesCommandSchema = z.object({
  characterId: z.uuid(),
  /** How many alternative sets to generate (kept small for a calm review grid). */
  setCount: z.number().int().min(1).max(4).default(2),
});

/** Approve one candidate set into the character's visual profile. */
export const ApproveCandidateSetCommandSchema = z.object({
  characterId: z.uuid(),
  candidateSetId: z.uuid(),
});

/** Discard one candidate set. */
export const RejectCandidateSetCommandSchema = ApproveCandidateSetCommandSchema;

/** Identify a single asset for authorized delivery (route params). */
export const DeliverAssetParamsSchema = z.object({
  characterId: z.uuid(),
  assetId: z.uuid(),
});

export type RequestCandidatesCommand = z.infer<
  typeof RequestCandidatesCommandSchema
>;
export type ApproveCandidateSetCommand = z.infer<
  typeof ApproveCandidateSetCommandSchema
>;
export type RejectCandidateSetCommand = z.infer<
  typeof RejectCandidateSetCommandSchema
>;
