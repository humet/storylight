import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCharacterCommands } from "@/application/character-commands";
import { createCharacterQueries } from "@/application/character-queries";
import type { AuthenticatedActor } from "@/domain/actor";
import type { CharacterProfilePayload } from "@/domain/character";
import { isDomainError } from "@/lib/errors";
import type { Database } from "./client";
import { createCharacterRepository } from "./repositories/character-repository";
import { createFamilyRepository } from "./repositories/family-repository";
import { characterProfileVersions, childCharacters, users } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

/**
 * Milestone 3 exit criteria (`docs/IMPLEMENTATION_PLAN.md`): "two active
 * characters can be created and read from the server" and "permanent changes
 * create versions". Every test runs the REAL command/query services and
 * repositories against a migrated-from-empty PGlite — no mocks — so it also
 * exercises the family-scoping and versioning invariants end to end.
 */

let harness: TestDatabase;
let db: Database;
let familyRepo: ReturnType<typeof createFamilyRepository>;
let characterRepo: ReturnType<typeof createCharacterRepository>;
let commands: ReturnType<typeof createCharacterCommands>;
let queries: ReturnType<typeof createCharacterQueries>;

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

function payload(
  overrides: Partial<CharacterProfilePayload> = {},
): CharacterProfilePayload {
  return {
    displayName: "Rosa",
    apparentAge: 7,
    pronouns: ["she", "her"],
    appearanceNotes: null,
    narrativeIdentity: {
      personalityTraits: [
        {
          name: "Meticulous",
          description: "Notices small inconsistencies others miss.",
          behaviouralSignals: ["prefers to inspect before acting"],
          overuseRisks: ["do not make every scene about tidiness"],
        },
      ],
      strengths: ["brave when protecting someone"],
      vulnerabilities: ["nervous when uncertain"],
      interests: ["beetles"],
      values: ["fairness"],
      speechStyle: {
        sentenceLength: "mixed",
        directness: "reflective",
        humourStyle: ["gentle wordplay"],
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
    ...overrides,
  };
}

beforeEach(async () => {
  harness = await createTestDatabase();
  db = harness.db;
  familyRepo = createFamilyRepository(db);
  characterRepo = createCharacterRepository(db);
  const deps = {
    familyRepository: familyRepo,
    characterRepository: characterRepo,
  };
  commands = createCharacterCommands(deps);
  queries = createCharacterQueries(deps);
});

afterEach(async () => {
  await harness.close();
});

describe("creating and reading characters", () => {
  it("creates two active characters that can be read back from the server", async () => {
    const userId = await seedUser("owner-1");
    const familyId = await seedFamily(userId, "The Testers");
    const actor = ownerActor(userId, familyId);

    const rosa = await commands.createCharacterProfile(
      actor,
      payload({ displayName: "Rosa" }),
    );
    const milo = await commands.createCharacterProfile(
      actor,
      payload({ displayName: "Milo" }),
    );

    expect(rosa.status).toBe("draft");
    expect(milo.status).toBe("draft");
    // App-generated semantic keys, never a supplied id.
    expect(rosa.key).toMatch(/^rosa-[0-9a-z]+$/);
    expect(milo.key).toMatch(/^milo-[0-9a-z]+$/);

    await commands.approveCharacterProfile(actor, { characterId: rosa.id });
    await commands.approveCharacterProfile(actor, { characterId: milo.id });

    const profiles = await queries.getCharacterProfiles(actor);
    expect(profiles).toHaveLength(2);
    expect(profiles.every((p) => p.status === "active")).toBe(true);

    const readRosa = await queries.getCharacterProfile(actor, rosa.id);
    expect(readRosa?.status).toBe("active");
    expect(readRosa?.approvedAt).toBeInstanceOf(Date);
    expect(readRosa?.displayName).toBe("Rosa");
  });

  it("enforces UNIQUE(family_id, character_key) semantics via distinct keys", async () => {
    const userId = await seedUser("owner-keys");
    const familyId = await seedFamily(userId, "Keys");
    const actor = ownerActor(userId, familyId);

    const a = await commands.createCharacterProfile(actor, payload());
    const b = await commands.createCharacterProfile(actor, payload());
    // Same display name → same slug stem, but distinct random suffixes.
    expect(a.key).not.toBe(b.key);
  });
});

describe("versioning (permanent changes)", () => {
  it("creates a new version row on a permanent change", async () => {
    const userId = await seedUser("owner-2");
    const familyId = await seedFamily(userId, "Versions");
    const actor = ownerActor(userId, familyId);

    const created = await commands.createCharacterProfile(actor, payload());
    expect(created.version).toBe(1);

    const updated = await commands.updateCharacterProfile(actor, {
      characterId: created.id,
      payload: payload({ apparentAge: 8 }),
    });
    expect(updated.version).toBe(2);
    expect(updated.apparentAge).toBe(8);

    // Two immutable version rows exist; the character points at v2.
    const versionRows = await db
      .select()
      .from(characterProfileVersions)
      .where(eq(characterProfileVersions.characterId, created.id));
    expect(versionRows).toHaveLength(2);

    const [character] = await db
      .select()
      .from(childCharacters)
      .where(eq(childCharacters.id, created.id));
    expect(character.currentVersion).toBe(2);
    const v2 = versionRows.find((r) => r.version === 2);
    expect(character.currentVersionId).toBe(v2?.id);
  });

  it("does not mint a version on approve/retire (lifecycle only)", async () => {
    const userId = await seedUser("owner-3");
    const familyId = await seedFamily(userId, "Lifecycle");
    const actor = ownerActor(userId, familyId);

    const created = await commands.createCharacterProfile(actor, payload());
    await commands.approveCharacterProfile(actor, { characterId: created.id });
    await commands.retireCharacterProfile(actor, { characterId: created.id });

    const versionRows = await db
      .select()
      .from(characterProfileVersions)
      .where(eq(characterProfileVersions.characterId, created.id));
    expect(versionRows).toHaveLength(1);
  });
});

describe("appearance notes (parent-authored physical description)", () => {
  it("stores trimmed notes and reads them back on the profile", async () => {
    const userId = await seedUser("owner-notes");
    const familyId = await seedFamily(userId, "Notes");
    const actor = ownerActor(userId, familyId);

    const created = await commands.createCharacterProfile(
      actor,
      payload({ appearanceNotes: "  Curly red hair, round glasses  " }),
    );
    const read = await queries.getCharacterProfile(actor, created.id);
    expect(read?.appearanceNotes).toBe("Curly red hair, round glasses");
  });

  it("mints a new version whose notes change while the v1 row keeps the old value", async () => {
    const userId = await seedUser("owner-notes-v2");
    const familyId = await seedFamily(userId, "NotesVersions");
    const actor = ownerActor(userId, familyId);

    const created = await commands.createCharacterProfile(
      actor,
      payload({ appearanceNotes: "Curly red hair" }),
    );
    const updated = await commands.updateCharacterProfile(actor, {
      characterId: created.id,
      payload: payload({
        appearanceNotes: "Short brown hair, a yellow raincoat",
      }),
    });
    expect(updated.version).toBe(2);
    expect(updated.appearanceNotes).toBe("Short brown hair, a yellow raincoat");

    // The immutable v1 row still holds the original notes.
    const rows = await db
      .select()
      .from(characterProfileVersions)
      .where(eq(characterProfileVersions.characterId, created.id));
    const v1 = rows.find((r) => r.version === 1);
    expect(v1?.appearanceNotes).toBe("Curly red hair");
  });

  it("defaults to null when the parent gives no notes", async () => {
    const userId = await seedUser("owner-no-notes");
    const familyId = await seedFamily(userId, "NoNotes");
    const actor = ownerActor(userId, familyId);

    const created = await commands.createCharacterProfile(actor, payload());
    const read = await queries.getCharacterProfile(actor, created.id);
    expect(read?.appearanceNotes).toBeNull();
  });
});

describe("approval lifecycle", () => {
  it("flips draft → active and rejects a second approval", async () => {
    const userId = await seedUser("owner-4");
    const familyId = await seedFamily(userId, "Approval");
    const actor = ownerActor(userId, familyId);

    const created = await commands.createCharacterProfile(actor, payload());
    const approved = await commands.approveCharacterProfile(actor, {
      characterId: created.id,
    });
    expect(approved.status).toBe("active");

    await expect(
      commands.approveCharacterProfile(actor, { characterId: created.id }),
    ).rejects.toSatisfy(
      (e: unknown) => isDomainError(e) && e.code === "INVALID_COMMAND",
    );
  });
});

describe("cross-family isolation", () => {
  it("hides another family's characters from reads and blocks writes", async () => {
    const alice = await seedUser("alice");
    const bob = await seedUser("bob");
    const familyA = await seedFamily(alice, "Alice family");
    const familyB = await seedFamily(bob, "Bob family");

    const aliceActor = ownerActor(alice, familyA);
    const bobActor = ownerActor(bob, familyB);

    const rosa = await commands.createCharacterProfile(
      aliceActor,
      payload({ displayName: "Rosa" }),
    );

    // Bob (a valid owner of his OWN family) sees none of Alice's characters.
    expect(await queries.getCharacterProfiles(bobActor)).toHaveLength(0);
    expect(await queries.getCharacterProfile(bobActor, rosa.id)).toBeNull();

    // Bob cannot mutate Alice's character even though he is authorised in B.
    await expect(
      commands.updateCharacterProfile(bobActor, {
        characterId: rosa.id,
        payload: payload({ apparentAge: 99 }),
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isDomainError(e) && e.code === "INVALID_COMMAND",
    );
    await expect(
      commands.approveCharacterProfile(bobActor, { characterId: rosa.id }),
    ).rejects.toSatisfy(
      (e: unknown) => isDomainError(e) && e.code === "INVALID_COMMAND",
    );

    // Alice's character is untouched.
    const readRosa = await queries.getCharacterProfile(aliceActor, rosa.id);
    expect(readRosa?.apparentAge).toBe(7);
    expect(readRosa?.status).toBe("draft");
  });
});

describe("relationships", () => {
  it("records a relationship between two characters in the same family", async () => {
    const userId = await seedUser("owner-rel");
    const familyId = await seedFamily(userId, "Rels");
    const actor = ownerActor(userId, familyId);

    const rosa = await commands.createCharacterProfile(
      actor,
      payload({ displayName: "Rosa" }),
    );
    const milo = await commands.createCharacterProfile(
      actor,
      payload({ displayName: "Milo" }),
    );

    const relationship = await characterRepo.createRelationship({
      familyId,
      relationship: {
        fromCharacterId: rosa.id,
        toCharacterId: milo.id,
        type: "sibling",
        baseline: "warmth, rivalry, humour and repair",
        boundaries: ["never becomes best-friends-who-always-agree"],
      },
    });
    expect(relationship).not.toBeNull();

    const all = await characterRepo.listRelationships(familyId);
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("sibling");
  });

  it("refuses to link a character from another family", async () => {
    const alice = await seedUser("alice-rel");
    const bob = await seedUser("bob-rel");
    const familyA = await seedFamily(alice, "A");
    const familyB = await seedFamily(bob, "B");
    const aliceActor = ownerActor(alice, familyA);
    const bobActor = ownerActor(bob, familyB);

    const rosa = await commands.createCharacterProfile(
      aliceActor,
      payload({ displayName: "Rosa" }),
    );
    const bobsChild = await commands.createCharacterProfile(
      bobActor,
      payload({ displayName: "Sam" }),
    );

    // Try to relate Alice's Rosa to Bob's Sam, scoped to Alice's family.
    const relationship = await characterRepo.createRelationship({
      familyId: familyA,
      relationship: {
        fromCharacterId: rosa.id,
        toCharacterId: bobsChild.id,
        type: "friend",
        baseline: "should never be allowed",
        boundaries: [],
      },
    });
    expect(relationship).toBeNull();
  });
});
