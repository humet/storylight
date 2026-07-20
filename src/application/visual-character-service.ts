import type { AuthenticatedActor } from "@/domain/actor";
import type { FamilyCapability } from "@/domain/authorization";
import {
  buildCharacterVisualDescriptor,
  type CharacterVisualDescriptor,
} from "@/domain/character-visual-descriptor";
import { assertDecodableImage } from "@/domain/image-validation";
import { nameBasedUuid } from "@/domain/name-uuid";
import {
  orderByReferenceView,
  REFERENCE_VIEWS,
  type ReferenceView,
} from "@/domain/reference-view";
import { buildVisualAssetKey } from "@/domain/storage-keys";
import {
  ART_BIBLE_VERSION,
  type CandidateSet,
  type ReferenceAsset,
} from "@/domain/visual-asset";
import {
  applyVisualAssetTransition,
  isDeliverable,
} from "@/domain/visual-asset-state";
import {
  generationFailedError,
  invalidCommandError,
  unauthorisedError,
} from "@/lib/errors";
import { authorizeFamilyAction } from "./family-access";
import type { ImageModel } from "./ports/image-model";
import type { ObjectStorage } from "./ports/object-storage";
import type { CharacterRepository } from "./ports/character-repository";
import type { FamilyRepository } from "./ports/family-repository";
import type { NewVisualAsset } from "./ports/visual-asset-repository";
import type { VisualAssetRepository } from "./ports/visual-asset-repository";
import {
  ApproveCandidateSetCommandSchema,
  RejectCandidateSetCommandSchema,
  RequestCandidatesCommandSchema,
} from "./visual-character-schemas";

/**
 * Visual-character service (`docs/03-ai/image-generation.md`, ADR-003). It owns
 * the candidate → review → approve → deliver flow, always:
 *
 *  1. resolves the actor's family and AUTHORISES the specific capability
 *     (`character:manage` to generate/approve, `story:read` to receive an
 *     approved reference) via `authorizeFamilyAction` — never trusting an id;
 *  2. parses input with a Zod v4 schema at the boundary;
 *  3. drives the model + storage + repository PORTS only — no provider SDK, no
 *     Drizzle (domain rule 12).
 *
 * M4 runs candidate generation as a plain synchronous service (the fake adapter
 * is fast). The durable workflow engine arrives in M5; this shape is ready to
 * move onto the JobDispatcher port then without changing its callers.
 */

export interface VisualCharacterDeps {
  familyRepository: FamilyRepository;
  characterRepository: CharacterRepository;
  visualAssetRepository: VisualAssetRepository;
  objectStorage: ObjectStorage;
  imageModel: ImageModel;
}

/** Kind of delivery a caller is authorised for — sets the allowed asset state. */
export type DeliveryKind = "approved" | "candidate";

/** Options for {@link VisualCharacterService.requestCandidateSets}. */
export interface RequestCandidatesOptions {
  /**
   * A STABLE key (e.g. `${workflowId}:${stageKey}`) under which this generation
   * runs. When present, every candidate-set id, asset id, and seed is DERIVED
   * deterministically from it, so a crash-and-retry of the same workflow stage
   * reproduces the exact same ids/keys/bytes instead of minting a duplicate
   * quarantined set (a duplicated paid generation in M6). When absent (a direct,
   * non-durable call) ids stay random, preserving the original behaviour.
   */
  idempotencyKey?: string;
}

export interface DeliveredAsset {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Generate ONE reference view for a candidate set. The per-view unit the durable
 * M4 workflow drives as its own engine stage (one image call = one WDK step), so a
 * function time-out replays only a single view — never the whole set — and can
 * never re-spend on the other five. `idempotencyKey` (the workflow id) makes the
 * candidate-set id, asset id, seed, and storage key DETERMINISTIC, so a replayed
 * view reproduces the exact same asset/key/bytes.
 */
export interface GenerateCandidateViewInput {
  characterId: string;
  /** Which set this view belongs to (fixed to 0 for the single-set MVP). */
  setIndex: number;
  view: ReferenceView;
  idempotencyKey: string;
}

/** Assemble the candidate-set record from the per-view assets already uploaded. */
export interface AssembleCandidateSetInput {
  characterId: string;
  setIndex: number;
  idempotencyKey: string;
  assets: NewVisualAsset[];
}

function requirePrimaryFamily(actor: AuthenticatedActor): string {
  const familyId = actor.familyIds[0];
  if (!familyId) {
    throw unauthorisedError({
      internalDetail: `Actor ${actor.userId} has no family to act in.`,
      stage: "visual.family",
    });
  }
  return familyId;
}

/** SHA-256 of bytes as lowercase hex (Web Crypto — portable, no node import). */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Deterministic seed from stable inputs (FNV-1a), masked to a positive 31-bit
 * integer so it fits Postgres `integer` (signed int32).
 */
function seedFrom(...parts: string[]): number {
  let h = 0x811c9dc5;
  const input = parts.join(":");
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h & 0x7fffffff;
}

export function createVisualCharacterService(deps: VisualCharacterDeps) {
  const {
    familyRepository,
    characterRepository,
    visualAssetRepository,
    objectStorage,
    imageModel,
  } = deps;

  async function authorise(
    actor: AuthenticatedActor,
    capability: FamilyCapability,
  ): Promise<string> {
    const familyId = requirePrimaryFamily(actor);
    await authorizeFamilyAction(familyRepository, {
      userId: actor.userId,
      familyId,
      capability,
    });
    return familyId;
  }

  async function loadCharacterOrThrow(
    familyId: string,
    characterId: string,
    stage: string,
  ) {
    const profile = await characterRepository.getCharacter(
      familyId,
      characterId,
    );
    if (!profile) {
      throw invalidCommandError({
        safeMessage: "That character could not be found.",
        internalDetail: `Character ${characterId} not in family ${familyId}.`,
        stage,
      });
    }
    return profile;
  }

  /**
   * Authorise + load the character + resolve the model-neutral inputs a candidate
   * generation needs (descriptor + the PROSPECTIVE visual-profile version the
   * storage key targets). Shared by the whole-set direct call and the per-view
   * durable path, so both authorise identically and derive the same storage keys.
   */
  async function resolveGenerationContext(
    actor: AuthenticatedActor,
    characterId: string,
    stage: string,
  ): Promise<{
    familyId: string;
    descriptor: CharacterVisualDescriptor;
    prospectiveVersion: number;
  }> {
    const familyId = await authorise(actor, "character:manage");
    const profile = await loadCharacterOrThrow(familyId, characterId, stage);
    if (profile.status === "retired") {
      throw invalidCommandError({
        safeMessage: "Resting characters cannot be repainted.",
        internalDetail: `Character ${characterId} is retired.`,
        stage,
      });
    }
    const descriptor = buildCharacterVisualDescriptor(profile);
    // Candidates target the character's NEXT visual-profile version for their
    // storage key (the eventual approved version is assigned on approval).
    const prospectiveVersion =
      (await visualAssetRepository.getLatestVisualProfileVersion(
        familyId,
        characterId,
      )) + 1;
    return { familyId, descriptor, prospectiveVersion };
  }

  /**
   * The candidate-set id for `(idempotencyKey, setIndex)`. Deterministic under a
   * durable workflow (an idempotent re-run reproduces it) and random for a direct,
   * non-durable call. Every downstream id/seed/key derives from it, so determinism
   * flows automatically.
   */
  async function candidateSetIdFor(
    idempotencyKey: string | undefined,
    setIndex: number,
  ): Promise<string> {
    return idempotencyKey
      ? await nameBasedUuid(idempotencyKey, "set", String(setIndex))
      : globalThis.crypto.randomUUID();
  }

  /**
   * Render ONE reference view via the image port, validate it, upload it PRIVATE,
   * and return its quarantined-asset metadata (bytes are in storage, never in the
   * return value or any workflow payload). The single paid unit of candidate
   * generation — this is what one durable engine stage does exactly once.
   */
  async function paintOneView(args: {
    familyId: string;
    characterId: string;
    descriptor: CharacterVisualDescriptor;
    prospectiveVersion: number;
    candidateSetId: string;
    view: ReferenceView;
    idempotencyKey: string | undefined;
  }): Promise<NewVisualAsset> {
    const {
      familyId,
      characterId,
      descriptor,
      prospectiveVersion,
      candidateSetId,
      view,
      idempotencyKey,
    } = args;
    const assetId = idempotencyKey
      ? await nameBasedUuid(candidateSetId, "asset", view)
      : globalThis.crypto.randomUUID();
    const seed = seedFrom(candidateSetId, view);
    const image = await imageModel.generate({
      view,
      descriptor,
      artBibleVersion: ART_BIBLE_VERSION,
      seed,
    });

    // MIME + decode validation BEFORE the private upload.
    assertDecodableImage(image.bytes, image.contentType);
    const checksum = await sha256Hex(image.bytes);
    const key = buildVisualAssetKey({
      familyId,
      characterId,
      version: prospectiveVersion,
      assetId,
    });

    const stored = await objectStorage.put({
      key,
      bytes: image.bytes,
      contentType: image.contentType,
      checksum,
    });
    if (stored.size !== image.bytes.byteLength) {
      throw generationFailedError({
        internalDetail: `Stored size ${stored.size} != generated ${image.bytes.byteLength} for ${key}.`,
        stage: "visual.upload",
      });
    }

    return {
      id: assetId,
      view,
      storageKey: key,
      contentType: image.contentType,
      checksum,
      byteSize: image.bytes.byteLength,
      width: image.width,
      height: image.height,
      model: image.model,
      seed: image.seed,
    };
  }

  return {
    /**
     * Generate `setCount` candidate reference sets for a character (the direct,
     * NON-durable path — e.g. tests). Each view is painted + validated + uploaded
     * and the set recorded. The durable M4 workflow does NOT call this; it drives
     * {@link generateCandidateView} per view + {@link assembleCandidateSet}, so a
     * function time-out never re-spends more than a single view.
     */
    async requestCandidateSets(
      actor: AuthenticatedActor,
      input: unknown,
      options: RequestCandidatesOptions = {},
    ): Promise<CandidateSet[]> {
      const { characterId, setCount } =
        RequestCandidatesCommandSchema.parse(input);
      const ctx = await resolveGenerationContext(
        actor,
        characterId,
        "visual.request",
      );
      const { idempotencyKey } = options;
      const created: CandidateSet[] = [];
      for (let setIndex = 0; setIndex < setCount; setIndex++) {
        const candidateSetId = await candidateSetIdFor(
          idempotencyKey,
          setIndex,
        );
        const assets: NewVisualAsset[] = [];
        for (const view of REFERENCE_VIEWS) {
          assets.push(
            await paintOneView({
              ...ctx,
              characterId,
              candidateSetId,
              view,
              idempotencyKey,
            }),
          );
        }
        created.push(
          await visualAssetRepository.recordCandidateSet({
            familyId: ctx.familyId,
            characterId,
            candidateSetId,
            assets,
          }),
        );
      }
      return created;
    },

    /**
     * Paint ONE reference view for a candidate set (the durable per-stage unit).
     * Authorises + loads the character every call (defence in depth; cheap reads),
     * derives the deterministic candidate-set + asset ids from `idempotencyKey`,
     * and returns the quarantined-asset metadata for the workflow to persist as its
     * stage output. Recording the set is deferred to {@link assembleCandidateSet}.
     */
    async generateCandidateView(
      actor: AuthenticatedActor,
      input: GenerateCandidateViewInput,
    ): Promise<NewVisualAsset> {
      const ctx = await resolveGenerationContext(
        actor,
        input.characterId,
        "visual.request",
      );
      const candidateSetId = await candidateSetIdFor(
        input.idempotencyKey,
        input.setIndex,
      );
      return paintOneView({
        ...ctx,
        characterId: input.characterId,
        candidateSetId,
        view: input.view,
        idempotencyKey: input.idempotencyKey,
      });
    },

    /**
     * Assemble the quarantined candidate-set record from the per-view assets the
     * paint stages already uploaded (the final durable stage). The candidate-set id
     * is re-derived from the same `(idempotencyKey, setIndex)`, so the record links
     * exactly the assets those stages produced; the repository insert is
     * `onConflictDoNothing`, so a replay collapses to the same set.
     */
    async assembleCandidateSet(
      actor: AuthenticatedActor,
      input: AssembleCandidateSetInput,
    ): Promise<CandidateSet> {
      const familyId = await authorise(actor, "character:manage");
      await loadCharacterOrThrow(familyId, input.characterId, "visual.request");
      const candidateSetId = await candidateSetIdFor(
        input.idempotencyKey,
        input.setIndex,
      );
      return visualAssetRepository.recordCandidateSet({
        familyId,
        characterId: input.characterId,
        candidateSetId,
        assets: input.assets,
      });
    },

    /** The character's quarantined candidate sets awaiting review. */
    async listPendingCandidateSets(
      actor: AuthenticatedActor,
      characterId: string,
    ): Promise<CandidateSet[]> {
      const familyId = await authorise(actor, "character:manage");
      return visualAssetRepository.listCandidateSetsByState(
        familyId,
        characterId,
        "quarantined",
      );
    },

    /** The character's current APPROVED reference set (ordered), or empty. */
    async getApprovedReferenceSet(
      actor: AuthenticatedActor,
      characterId: string,
    ): Promise<ReferenceAsset[]> {
      const familyId = await authorise(actor, "story:read");
      return visualAssetRepository.getApprovedReferenceSet(
        familyId,
        characterId,
      );
    },

    /**
     * Approve one candidate set: mark its assets approved, reject the sibling
     * sets, mint the next immutable visual-profile version, link the ordered
     * reference set, and repoint the character. Returns the new profile version.
     */
    async approveCandidateSet(actor: AuthenticatedActor, input: unknown) {
      const familyId = await authorise(actor, "character:manage");
      const { characterId, candidateSetId } =
        ApproveCandidateSetCommandSchema.parse(input);
      await loadCharacterOrThrow(familyId, characterId, "visual.approve");

      const pending = await visualAssetRepository.listCandidateSetsByState(
        familyId,
        characterId,
        "quarantined",
      );
      const set = pending.find((s) => s.id === candidateSetId);
      if (!set) {
        throw invalidCommandError({
          safeMessage: "Those candidates are no longer available to approve.",
          internalDetail: `Quarantined set ${candidateSetId} not found for character ${characterId} in family ${familyId}.`,
          stage: "visual.approve",
        });
      }

      // Pure transition check per asset (defence: they are all quarantined).
      const ordered = orderByReferenceView(set.assets).map((asset, index) => {
        applyVisualAssetTransition(asset.state, "approve");
        return { assetId: asset.id, view: asset.view, position: index };
      });

      const profile = await visualAssetRepository.approveCandidateSet({
        familyId,
        characterId,
        candidateSetId,
        artBibleVersion: ART_BIBLE_VERSION,
        orderedAssets: ordered,
      });
      if (!profile) {
        throw invalidCommandError({
          safeMessage: "Those candidates are no longer available to approve.",
          internalDetail: `Approval raced for set ${candidateSetId}.`,
          stage: "visual.approve",
        });
      }
      return profile;
    },

    /** Discard one candidate set (mark its assets rejected). */
    async rejectCandidateSet(
      actor: AuthenticatedActor,
      input: unknown,
    ): Promise<void> {
      const familyId = await authorise(actor, "character:manage");
      const { characterId, candidateSetId } =
        RejectCandidateSetCommandSchema.parse(input);
      const rejected = await visualAssetRepository.rejectCandidateSet({
        familyId,
        characterId,
        candidateSetId,
      });
      if (!rejected) {
        throw invalidCommandError({
          safeMessage: "Those candidates are no longer available.",
          internalDetail: `No quarantined set ${candidateSetId} for character ${characterId} in family ${familyId}.`,
          stage: "visual.reject",
        });
      }
    },

    /**
     * Resolve the bytes of a single asset for authorized delivery. The STATE
     * FILTER is enforced here, not just in the route:
     *  - `approved`  → only `approved` assets (reader delivery, `story:read`);
     *  - `candidate` → only `quarantined` assets (parent review, `character:manage`).
     * Rejected/retired/deletion-pending assets match NEITHER, so they are
     * unreachable from every delivery path. Returns `null` for anything the actor
     * may not see, so the route answers a uniform 404.
     */
    async resolveDeliverableAsset(
      actor: AuthenticatedActor,
      characterId: string,
      assetId: string,
      kind: DeliveryKind,
    ): Promise<DeliveredAsset | null> {
      const capability: FamilyCapability =
        kind === "approved" ? "story:read" : "character:manage";
      const familyId = await authorise(actor, capability);

      const asset = await visualAssetRepository.getAsset(
        familyId,
        characterId,
        assetId,
      );
      if (!asset) return null;

      const permitted =
        kind === "approved"
          ? isDeliverable(asset.state)
          : asset.state === "quarantined";
      if (!permitted) return null;

      // Defence in depth for reader delivery: an approved asset must also belong
      // to the character's CURRENT visual profile. Re-approval retires the prior
      // version's assets, but this second gate means a superseded reference id
      // 404s even if that transition were ever missed (domain rule 6/8: readers
      // only ever see the current approved reference set).
      if (kind === "approved") {
        const currentProfileId =
          await visualAssetRepository.getCurrentVisualProfileId(
            familyId,
            characterId,
          );
        if (!currentProfileId || asset.visualProfileId !== currentProfileId) {
          return null;
        }
      }

      const object = await objectStorage.read(asset.storageKey);
      if (!object) return null;
      return { bytes: object.bytes, contentType: asset.contentType };
    },
  };
}

export type VisualCharacterService = ReturnType<
  typeof createVisualCharacterService
>;
