import { describe, expect, it } from "vitest";

import { LANGUAGE_CAPABILITIES } from "@/domain/model-capability";
import { DEFAULT_MODEL_ROUTES } from "./default-model-routes";

/**
 * Sanity of the seeded default route set. The DB-vs-TS drift guard lives in the
 * DB integration test (which reads the seeded rows); this asserts the TS source
 * of truth is well-formed.
 */
describe("default model routes", () => {
  it("provides exactly one active route per language capability", () => {
    const byCapability = new Map(
      DEFAULT_MODEL_ROUTES.map((r) => [r.capability, r]),
    );
    for (const capability of LANGUAGE_CAPABILITIES) {
      const route = byCapability.get(capability);
      expect(route, `route for ${capability}`).toBeDefined();
      expect(route?.lifecycleStatus).toBe("active");
    }
    expect(DEFAULT_MODEL_ROUTES).toHaveLength(LANGUAGE_CAPABILITIES.length);
  });

  it("uses stable pinned slugs, never a mutable `latest` alias", () => {
    for (const route of DEFAULT_MODEL_ROUTES) {
      const slugs = [route.primaryTarget, ...route.fallbacks];
      for (const slug of slugs) {
        expect(slug).toMatch(/^[a-z0-9.-]+\/[a-z0-9.-]+$/);
        expect(slug).not.toContain("latest");
      }
      expect(route.settings.maxOutputTokens).toBeGreaterThan(0);
      // A bootstrap approval record is present (real evaluation approval is M10).
      expect(route.approvalRecord?.approvedBy).toBe("system:m6-seed");
    }
  });

  it("uses unique ids across routes", () => {
    const ids = new Set(DEFAULT_MODEL_ROUTES.map((r) => r.id));
    expect(ids.size).toBe(DEFAULT_MODEL_ROUTES.length);
  });
});
