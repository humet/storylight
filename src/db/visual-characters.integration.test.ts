import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFilesystemObjectStorage } from "@/adapters/storage/filesystem-object-storage";
import { createFakeImageModel } from "@/adapters/images/fake-image-model";
import { createCharacterCommands } from "@/application/character-commands";
import type {
  GeneratedImage,
  ImageGenerationSpec,
  ImageModel,
} from "@/application/ports/image-model";
import { createVisualCharacterService } from "@/application/visual-character-service";
import type { AuthenticatedActor } from "@/domain/actor";
import type { CharacterProfilePayload } from "@/domain/character";
import {
  ANCHOR_REFERENCE_VIEW,
  REFERENCE_VIEWS,
  type ReferenceView,
} from "@/domain/reference-view";
import { isDomainError } from "@/lib/errors";
import type { Database } from "./client";
import { createCharacterRepository } from "./repositories/character-repository";
import { createFamilyRepository } from "./repositories/family-repository";
import { createVisualAssetRepository } from "./repositories/visual-asset-repository";
import { users } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

/**
 * Milestone 4 exit criteria (`docs/IMPLEMENTATION_PLAN.md`): "a parent can
 * approve a fictional character reference set" and "rejected candidates are
 * inaccessible". Every test runs the REAL service + repositories against a
 * migrated-from-empty PGlite, with the filesystem object store and the
 * deterministic fake image model — no mocks — so the candidate → approve →
 * deliver pipeline, family scoping, version pinning, and delivery state filters
 * are all exercised end to end. No child production data is used (AGENTS.md).
 */

let harness: TestDatabase;
let db: Database;
let storageRoot: string;
let familyRepo: ReturnType<typeof createFamilyRepository>;
let characterRepo: ReturnType<typeof createCharacterRepository>;
let visualRepo: ReturnType<typeof createVisualAssetRepository>;
let commands: ReturnType<typeof createCharacterCommands>;
let visual: ReturnType<typeof createVisualCharacterService>;

async function seedUser(id: string): Promise<string> {
  await db.insert(users).values({
    id,
    name: `User ${id}`,
    email: `${id}@example.test`,
    emailVerified: true,
  });
  return id;
}

async function seedFamily(userId: string, familyName: string): Promise<string> {
  const { family } = await familyRepo.createFamilyWithOwner({
    userId,
    familyName,
  });
  return family.id;
}

function ownerActor(userId: string, familyId: string): AuthenticatedActor {
  return { userId, familyIds: [familyId], roles: ["owner"] };
}

function payload(displayName: string): CharacterProfilePayload {
  return {
    displayName,
    apparentAge: 7,
    pronouns: ["they", "them"],
    narrativeIdentity: {
      personalityTraits: [],
      strengths: [],
      vulnerabilities: [],
      interests: ["beetles", "maps"],
      values: [],
      speechStyle: {
        sentenceLength: "mixed",
        directness: "reflective",
        humourStyle: [],
        vocabularyNotes: [],
        prohibitedPatterns: [],
      },
      behaviourRules: [],
      forbiddenCharacterisations: [],
    },
    fictionalisationPolicy: {
      mayUseMagic: true,
      mayTransformTemporarily: true,
      mayPortrayMildDisagreement: true,
      mayPortrayFear: true,
      mayUseRealFamilyMembers: false,
      mayInventSchoolOrHomeDetails: false,
      excludedThemes: [],
    },
    visualProfileId: null,
  };
}

async function newCharacter(actor: AuthenticatedActor, name: string) {
  return commands.createCharacterProfile(actor, payload(name));
}

beforeEach(async () => {
  harness = await createTestDatabase();
  db = harness.db;
  storageRoot = await mkdtemp(path.join(tmpdir(), "storylight-storage-"));
  familyRepo = createFamilyRepository(db);
  characterRepo = createCharacterRepository(db);
  visualRepo = createVisualAssetRepository(db);
  const deps = {
    familyRepository: familyRepo,
    characterRepository: characterRepo,
  };
  commands = createCharacterCommands(deps);
  visual = createVisualCharacterService({
    ...deps,
    visualAssetRepository: visualRepo,
    objectStorage: createFilesystemObjectStorage(storageRoot),
    imageModel: createFakeImageModel(),
  });
});

afterEach(async () => {
  await harness.close();
  await rm(storageRoot, { recursive: true, force: true });
});

describe("requesting candidates", () => {
  it("generates quarantined candidate sets with privately uploaded bytes", async () => {
    const user = await seedUser("owner-req");
    const familyId = await seedFamily(user, "Requesters");
    const actor = ownerActor(user, familyId);
    const character = await newCharacter(actor, "Rosa");

    const sets = await visual.requestCandidateSets(actor, {
      characterId: character.id,
      setCount: 2,
    });
    expect(sets).toHaveLength(2);
    // Six canonical views per set, front portrait first.
    expect(sets[0].assets).toHaveLength(6);
    expect(sets[0].assets[0].view).toBe("front-portrait");
    expect(sets[0].assets.every((a) => a.state === "quarantined")).toBe(true);

    const pending = await visual.listPendingCandidateSets(actor, character.id);
    expect(pending).toHaveLength(2);

    // The bytes are actually retrievable through the authorized candidate path.
    const firstAsset = pending[0].assets[0];
    const delivered = await visual.resolveDeliverableAsset(
      actor,
      character.id,
      firstAsset.id,
      "candidate",
    );
    expect(delivered).not.toBeNull();
    expect(delivered!.contentType).toBe("image/svg+xml");
    expect(delivered!.bytes.byteLength).toBeGreaterThan(0);
  });

  it("paints the anchor view first and conditions the other views on it (coherent set)", async () => {
    const user = await seedUser("owner-coherent");
    const familyId = await seedFamily(user, "Coherent");
    const actor = ownerActor(user, familyId);
    const character = await newCharacter(actor, "Rosa");

    // Spy model records call order + anchor conditioning, bytes from the fake.
    const fake = createFakeImageModel();
    const calls: Array<{ view: ReferenceView; hasAnchor: boolean }> = [];
    const spy: ImageModel = {
      async generate(spec: ImageGenerationSpec): Promise<GeneratedImage> {
        calls.push({ view: spec.view, hasAnchor: Boolean(spec.anchorImage) });
        return fake.generate(spec);
      },
    };
    const spied = createVisualCharacterService({
      familyRepository: familyRepo,
      characterRepository: characterRepo,
      visualAssetRepository: visualRepo,
      objectStorage: createFilesystemObjectStorage(storageRoot),
      imageModel: spy,
    });

    const sets = await spied.requestCandidateSets(actor, {
      characterId: character.id,
      setCount: 1,
    });

    // Recorded in canonical order (front portrait first) regardless of paint order.
    expect(sets[0].assets[0].view).toBe("front-portrait");
    expect(sets[0].assets).toHaveLength(REFERENCE_VIEWS.length);

    // Generation order: anchor first (unconditioned), then the rest conditioned.
    expect(calls).toHaveLength(REFERENCE_VIEWS.length);
    expect(calls[0].view).toBe(ANCHOR_REFERENCE_VIEW);
    expect(calls[0].hasAnchor).toBe(false);
    expect(calls.slice(1).every((c) => c.hasAnchor)).toBe(true);
    expect(calls.slice(1).every((c) => c.view !== ANCHOR_REFERENCE_VIEW)).toBe(
      true,
    );
  });

  it("refuses to paint a retired character", async () => {
    const user = await seedUser("owner-retired");
    const familyId = await seedFamily(user, "Retired");
    const actor = ownerActor(user, familyId);
    const character = await newCharacter(actor, "Bram");
    await commands.approveCharacterProfile(actor, {
      characterId: character.id,
    });
    await commands.retireCharacterProfile(actor, { characterId: character.id });

    await expect(
      visual.requestCandidateSets(actor, { characterId: character.id }),
    ).rejects.toSatisfy(
      (e: unknown) => isDomainError(e) && e.code === "INVALID_COMMAND",
    );
  });
});

describe("approving a reference set", () => {
  it("approves one set, mints a visual profile, links it, and rejects siblings", async () => {
    const user = await seedUser("owner-approve");
    const familyId = await seedFamily(user, "Approvers");
    const actor = ownerActor(user, familyId);
    const character = await newCharacter(actor, "Rosa");

    const sets = await visual.requestCandidateSets(actor, {
      characterId: character.id,
      setCount: 2,
    });
    const chosen = sets[0];
    const sibling = sets[1];

    const profile = await visual.approveCandidateSet(actor, {
      characterId: character.id,
      candidateSetId: chosen.id,
    });
    expect(profile.version).toBe(1);
    expect(profile.artBibleVersion).toBe("mvp-gouache-v1");

    // The character now points at the approved profile.
    const readBack = await characterRepo.getCharacter(familyId, character.id);
    expect(readBack?.visualProfileId).toBe(profile.id);

    // The approved reference set is ordered, front portrait first, and delivers.
    const references = await visual.getApprovedReferenceSet(
      actor,
      character.id,
    );
    expect(references).toHaveLength(6);
    expect(references[0].view).toBe("front-portrait");
    expect(references.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5]);

    const deliveredApproved = await visual.resolveDeliverableAsset(
      actor,
      character.id,
      references[0].id,
      "approved",
    );
    expect(deliveredApproved).not.toBeNull();
    expect(deliveredApproved!.bytes.byteLength).toBeGreaterThan(0);

    // No pending sets remain — the sibling was rejected on approval.
    const pending = await visual.listPendingCandidateSets(actor, character.id);
    expect(pending).toHaveLength(0);

    // The rejected sibling's assets are inaccessible via BOTH delivery paths.
    const rejectedAsset = sibling.assets[0];
    expect(
      await visual.resolveDeliverableAsset(
        actor,
        character.id,
        rejectedAsset.id,
        "approved",
      ),
    ).toBeNull();
    expect(
      await visual.resolveDeliverableAsset(
        actor,
        character.id,
        rejectedAsset.id,
        "candidate",
      ),
    ).toBeNull();
  });

  it("pins versions: re-approving a fresh set mints version 2", async () => {
    const user = await seedUser("owner-v2");
    const familyId = await seedFamily(user, "Versions");
    const actor = ownerActor(user, familyId);
    const character = await newCharacter(actor, "Rosa");

    const first = await visual.requestCandidateSets(actor, {
      characterId: character.id,
      setCount: 1,
    });
    const v1 = await visual.approveCandidateSet(actor, {
      characterId: character.id,
      candidateSetId: first[0].id,
    });
    expect(v1.version).toBe(1);

    const second = await visual.requestCandidateSets(actor, {
      characterId: character.id,
      setCount: 1,
    });
    const v2 = await visual.approveCandidateSet(actor, {
      characterId: character.id,
      candidateSetId: second[0].id,
    });
    expect(v2.version).toBe(2);

    // The character now points at v2, and v2's set is the delivered one.
    const readBack = await characterRepo.getCharacter(familyId, character.id);
    expect(readBack?.visualProfileId).toBe(v2.id);
  });

  it("retires the previous version's assets and 404s their ids after re-approval (Finding 4)", async () => {
    const user = await seedUser("owner-retire");
    const familyId = await seedFamily(user, "Retirers");
    const actor = ownerActor(user, familyId);
    const character = await newCharacter(actor, "Rosa");

    const first = await visual.requestCandidateSets(actor, {
      characterId: character.id,
      setCount: 1,
    });
    const v1 = await visual.approveCandidateSet(actor, {
      characterId: character.id,
      candidateSetId: first[0].id,
    });
    const v1Refs = await visual.getApprovedReferenceSet(actor, character.id);
    const v1AssetId = v1Refs[0].id;
    // v1 is deliverable while it is the current profile.
    expect(
      await visual.resolveDeliverableAsset(
        actor,
        character.id,
        v1AssetId,
        "approved",
      ),
    ).not.toBeNull();

    // Re-approve a fresh set → mints v2 and SUPERSEDES v1.
    const second = await visual.requestCandidateSets(actor, {
      characterId: character.id,
      setCount: 1,
    });
    const v2 = await visual.approveCandidateSet(actor, {
      characterId: character.id,
      candidateSetId: second[0].id,
    });
    expect(v2.version).toBe(2);
    expect(v2.id).not.toBe(v1.id);

    // The v1 asset is now RETIRED and unreachable on the delivery path.
    const retired = await visualRepo.getAsset(
      familyId,
      character.id,
      v1AssetId,
    );
    expect(retired?.state).toBe("retired");
    expect(
      await visual.resolveDeliverableAsset(
        actor,
        character.id,
        v1AssetId,
        "approved",
      ),
    ).toBeNull();

    // The current (v2) reference set streams fine.
    const v2Refs = await visual.getApprovedReferenceSet(actor, character.id);
    expect(v2Refs).toHaveLength(6);
    const streamed = await visual.resolveDeliverableAsset(
      actor,
      character.id,
      v2Refs[0].id,
      "approved",
    );
    expect(streamed).not.toBeNull();
    expect(streamed!.bytes.byteLength).toBeGreaterThan(0);
  });

  it("cannot approve an already-reviewed set twice", async () => {
    const user = await seedUser("owner-twice");
    const familyId = await seedFamily(user, "Twice");
    const actor = ownerActor(user, familyId);
    const character = await newCharacter(actor, "Rosa");
    const sets = await visual.requestCandidateSets(actor, {
      characterId: character.id,
      setCount: 1,
    });
    await visual.approveCandidateSet(actor, {
      characterId: character.id,
      candidateSetId: sets[0].id,
    });
    await expect(
      visual.approveCandidateSet(actor, {
        characterId: character.id,
        candidateSetId: sets[0].id,
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isDomainError(e) && e.code === "INVALID_COMMAND",
    );
  });
});

describe("explicit rejection", () => {
  it("marks a set rejected and makes it inaccessible from every path", async () => {
    const user = await seedUser("owner-reject");
    const familyId = await seedFamily(user, "Rejecters");
    const actor = ownerActor(user, familyId);
    const character = await newCharacter(actor, "Rosa");
    const sets = await visual.requestCandidateSets(actor, {
      characterId: character.id,
      setCount: 1,
    });
    const asset = sets[0].assets[0];

    await visual.rejectCandidateSet(actor, {
      characterId: character.id,
      candidateSetId: sets[0].id,
    });

    expect(await visual.listPendingCandidateSets(actor, character.id)).toEqual(
      [],
    );
    expect(
      await visual.resolveDeliverableAsset(
        actor,
        character.id,
        asset.id,
        "candidate",
      ),
    ).toBeNull();
    expect(
      await visual.resolveDeliverableAsset(
        actor,
        character.id,
        asset.id,
        "approved",
      ),
    ).toBeNull();
  });
});

describe("concurrent approval (Finding 3)", () => {
  it("lets one win, returns a safe domain error to the loser, mints exactly one version", async () => {
    const user = await seedUser("owner-race");
    const familyId = await seedFamily(user, "Racers");
    const actor = ownerActor(user, familyId);
    const character = await newCharacter(actor, "Rosa");

    const sets = await visual.requestCandidateSets(actor, {
      characterId: character.id,
      setCount: 2,
    });

    // Two parents approve two DIFFERENT sets at the same moment.
    const [a, b] = await Promise.allSettled([
      visual.approveCandidateSet(actor, {
        characterId: character.id,
        candidateSetId: sets[0].id,
      }),
      visual.approveCandidateSet(actor, {
        characterId: character.id,
        candidateSetId: sets[1].id,
      }),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
    const rejected = [a, b].filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    // Exactly one approval succeeds; the loser fails SAFELY (never a raw 500).
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = rejected[0].reason;
    expect(isDomainError(reason) && reason.code === "INVALID_COMMAND").toBe(
      true,
    );

    // Exactly one visual-profile version was minted.
    const latest = await visualRepo.getLatestVisualProfileVersion(
      familyId,
      character.id,
    );
    expect(latest).toBe(1);
  });
});

describe("cross-family isolation", () => {
  it("hides another family's candidates and approved references", async () => {
    const alice = await seedUser("alice-vis");
    const bob = await seedUser("bob-vis");
    const familyA = await seedFamily(alice, "Alice family");
    const familyB = await seedFamily(bob, "Bob family");
    const aliceActor = ownerActor(alice, familyA);
    const bobActor = ownerActor(bob, familyB);

    const character = await newCharacter(aliceActor, "Rosa");
    const sets = await visual.requestCandidateSets(aliceActor, {
      characterId: character.id,
      setCount: 1,
    });
    const candidate = sets[0].assets[0];
    const profile = await visual.approveCandidateSet(aliceActor, {
      characterId: character.id,
      candidateSetId: sets[0].id,
    });
    expect(profile.version).toBe(1);
    const references = await visual.getApprovedReferenceSet(
      aliceActor,
      character.id,
    );

    // Bob is a valid owner of his OWN family, but sees none of Alice's assets.
    expect(
      await visual.listPendingCandidateSets(bobActor, character.id),
    ).toEqual([]);
    expect(
      await visual.getApprovedReferenceSet(bobActor, character.id),
    ).toEqual([]);
    expect(
      await visual.resolveDeliverableAsset(
        bobActor,
        character.id,
        references[0].id,
        "approved",
      ),
    ).toBeNull();
    expect(
      await visual.resolveDeliverableAsset(
        bobActor,
        character.id,
        candidate.id,
        "candidate",
      ),
    ).toBeNull();

    // Bob cannot approve Alice's remaining candidates either.
    await expect(
      visual.approveCandidateSet(bobActor, {
        characterId: character.id,
        candidateSetId: sets[0].id,
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isDomainError(e) && e.code === "INVALID_COMMAND",
    );
  });
});
