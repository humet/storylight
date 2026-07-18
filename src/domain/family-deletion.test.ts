import { describe, expect, it } from "vitest";

import { assertOwnerRemovalAllowed, DELETION_STEPS } from "./family-deletion";
import { isDomainError } from "@/lib/errors";

describe("assertOwnerRemovalAllowed (the M2 owner-orphan guard)", () => {
  it("refuses to remove the LAST owner (would orphan the family)", () => {
    try {
      assertOwnerRemovalAllowed({
        ownerUserIds: ["owner-1"],
        removeUserId: "owner-1",
      });
      throw new Error("expected a throw");
    } catch (e) {
      expect(isDomainError(e) && e.code === "INVALID_COMMAND").toBe(true);
    }
  });

  it("allows removing an owner when another owner remains", () => {
    expect(() =>
      assertOwnerRemovalAllowed({
        ownerUserIds: ["owner-1", "owner-2"],
        removeUserId: "owner-1",
      }),
    ).not.toThrow();
  });

  it("allows removing a non-owner member", () => {
    expect(() =>
      assertOwnerRemovalAllowed({
        ownerUserIds: ["owner-1"],
        removeUserId: "parent-9",
      }),
    ).not.toThrow();
  });
});

describe("DELETION_STEPS", () => {
  it("are the three ordered, named steps", () => {
    expect(DELETION_STEPS).toEqual([
      "revoke-access",
      "purge-storage",
      "purge-database",
    ]);
  });
});
