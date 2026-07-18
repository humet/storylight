import { describe, expect, it } from "vitest";

import { isDomainError } from "@/lib/errors";
import type { ModelRouteRepository } from "../ports/model-route-repository";
import type { LanguageCapability } from "@/domain/model-capability";
import type { ModelRouteVersion } from "@/domain/model-route";
import { createModelRegistry } from "./model-registry";

function route(overrides: Partial<ModelRouteVersion> = {}): ModelRouteVersion {
  return {
    id: "active-1",
    capability: "chapter-writing",
    version: "1.0.0",
    primaryTarget: "anthropic/claude-sonnet-5",
    fallbacks: [],
    settings: { maxOutputTokens: 4000 },
    lifecycleStatus: "active",
    evaluationProfile: null,
    approvalRecord: null,
    ...overrides,
  };
}

function repo(routes: {
  active?: Record<string, ModelRouteVersion>;
  byId?: Record<string, ModelRouteVersion>;
}): ModelRouteRepository {
  return {
    async getActiveRoute(capability) {
      return routes.active?.[capability] ?? null;
    },
    async getRouteById(id) {
      return routes.byId?.[id] ?? null;
    },
    async listRoutesForCapability() {
      return [];
    },
  };
}

describe("model registry", () => {
  it("resolves the ACTIVE route for a capability", async () => {
    const active = route();
    const registry = createModelRegistry(
      repo({ active: { "chapter-writing": active } }),
    );
    const resolved = await registry.getLanguageRoute("chapter-writing");
    expect(resolved.id).toBe("active-1");
  });

  it("resolves a PINNED route version regardless of the active one", async () => {
    const active = route({ id: "active-1", version: "2.0.0" });
    const pinned = route({ id: "pinned-1", version: "1.0.0" });
    const registry = createModelRegistry(
      repo({
        active: { "chapter-writing": active },
        byId: { "pinned-1": pinned },
      }),
    );
    const resolved = await registry.getLanguageRoute("chapter-writing", {
      "chapter-writing": "pinned-1",
    });
    expect(resolved.id).toBe("pinned-1");
    expect(resolved.version).toBe("1.0.0");
  });

  it("throws a safe error when no active route exists", async () => {
    const registry = createModelRegistry(repo({}));
    await expect(
      registry.getLanguageRoute("chapter-writing"),
    ).rejects.toSatisfy((e: unknown) => isDomainError(e));
  });

  it("throws when a pin points at a route of a different capability", async () => {
    const mismatched = route({
      id: "pinned-x",
      capability: "series-planning" as LanguageCapability,
    });
    const registry = createModelRegistry(
      repo({ byId: { "pinned-x": mismatched } }),
    );
    await expect(
      registry.getLanguageRoute("chapter-writing", {
        "chapter-writing": "pinned-x",
      }),
    ).rejects.toSatisfy((e: unknown) => isDomainError(e));
  });
});
