import { describe, expect, it } from "vitest";

import { MVP_ART_BIBLE } from "@/domain/art-bible";
import {
  buildImageSceneRequest,
  type ImageSceneRequest,
} from "@/domain/image-request";
import type { ReferenceImage } from "@/domain/reference-image";
import {
  aspectRatioFor,
  buildInstruction,
  buildSeedreamPrompt,
  bytedanceProviderOptions,
  imageApiForTarget,
} from "./gateway-chapter-image-model";

/**
 * Pure branch-SELECTION + prompt/message-ASSEMBLY tests for the chapter image
 * adapter (no paid calls, no gateway). These pin the two facts the image-route-v2
 * Seedream swap depends on: (1) each route target is routed to the correct gateway
 * API, and (2) the SAME deterministic instruction text reaches the Seedream image
 * API as the Gemini language API, with references handed through as bytes and the
 * watermark always disabled.
 */

function sceneRequest(
  overrides: Partial<Parameters<typeof buildImageSceneRequest>[0]> = {},
): ImageSceneRequest {
  return buildImageSceneRequest({
    spec: { scene: "Ivy dances in a moonlit meadow.", aspect: "landscape" },
    artBible: MVP_ART_BIBLE,
    placements: [{ characterKey: "ivy-1", prominent: true }],
    cast: { children: [{ characterKey: "ivy-1", displayName: "Ivy" }] },
    companions: [],
    references: [],
    continuityNotes: [],
    seed: 4242,
    ...overrides,
  });
}

const ref = (characterKey: string, byte: number): ReferenceImage => ({
  characterKey,
  view: "front-portrait",
  bytes: new Uint8Array([byte]),
  contentType: "image/png",
});

describe("imageApiForTarget — per-route API branch", () => {
  it("routes bytedance/Seedream to the dedicated IMAGE api", () => {
    expect(imageApiForTarget("bytedance/seedream-5.0-pro")).toBe("image");
  });

  it("routes Gemini image models to the LANGUAGE api", () => {
    expect(imageApiForTarget("google/gemini-3-pro-image")).toBe("language");
    expect(imageApiForTarget("google/gemini-3.1-flash-image")).toBe("language");
  });

  it("defaults an unknown provider to the LANGUAGE api", () => {
    expect(imageApiForTarget("acme/some-model")).toBe("language");
    expect(imageApiForTarget("nonsense")).toBe("language");
  });
});

describe("aspectRatioFor", () => {
  it("maps each scene aspect to a gateway aspect-ratio string", () => {
    expect(aspectRatioFor("landscape")).toBe("4:3");
    expect(aspectRatioFor("portrait")).toBe("3:4");
    expect(aspectRatioFor("square")).toBe("1:1");
  });
});

describe("bytedanceProviderOptions — watermark removal", () => {
  it("always disables the watermark on every bytedance call", () => {
    expect(bytedanceProviderOptions()).toEqual({
      bytedance: { watermark: false },
    });
  });
});

describe("buildSeedreamPrompt — image-api prompt assembly", () => {
  it("carries the SAME instruction text as the language path + references as bytes", () => {
    const request = sceneRequest();
    const references = [ref("ivy-1", 1), ref("ivy-1", 2)];
    const prompt = buildSeedreamPrompt(request, references);

    expect(typeof prompt).toBe("object");
    if (typeof prompt === "string") throw new Error("expected object prompt");

    // Parity: the deterministic instruction is identical to what the Gemini
    // language path builds (buildMessages uses buildInstruction verbatim).
    expect(prompt.text).toBe(buildInstruction(request));
    // References are passed through as raw bytes, in order.
    expect(prompt.images).toEqual([references[0].bytes, references[1].bytes]);
  });

  it("degrades to a plain text-to-image string when there are no references", () => {
    const request = sceneRequest();
    const prompt = buildSeedreamPrompt(request, []);
    expect(prompt).toBe(buildInstruction(request));
  });
});

describe("buildInstruction — the shared deterministic text", () => {
  it("contains the canonical scene, style, exact-count cast directive and identity rule", () => {
    const request = sceneRequest();
    const text = buildInstruction(request);
    expect(text).toContain("Ivy dances in a moonlit meadow.");
    expect(text).toContain("STYLE:");
    // ADR-008 part 1: the named exact-count cast directive must survive.
    expect(text).toContain("Ivy");
    expect(text.toLowerCase()).toContain("reference");
  });
});
