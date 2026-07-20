import { describe, expect, it } from "vitest";

import { encodePng } from "./png-encoder";
import { createFakeChapterImageModel } from "./fake-chapter-image-model";
import type { ImageSceneRequest } from "@/domain/image-request";
import { assertTechnicalImage } from "@/domain/image-technical";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Read a big-endian uint32 from `bytes` at `offset`. */
function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

/** Parse the IHDR width/height and the first chunk type from a PNG buffer. */
function parseIhdr(bytes: Uint8Array): {
  width: number;
  height: number;
  chunkType: string;
  bitDepth: number;
  colourType: number;
} {
  // 8-byte signature, then a chunk: length(4) + type(4) + data + crc(4).
  const chunkType = String.fromCharCode(
    bytes[12],
    bytes[13],
    bytes[14],
    bytes[15],
  );
  return {
    width: readU32(bytes, 16),
    height: readU32(bytes, 20),
    chunkType,
    bitDepth: bytes[24],
    colourType: bytes[25],
  };
}

describe("png-encoder", () => {
  it("produces a valid, decodable PNG with the requested dimensions", () => {
    const width = 64;
    const height = 48;
    const bytes = encodePng({
      width,
      height,
      pixel: () => ({ r: 200, g: 120, b: 80 }),
    });

    // Signature.
    expect(Array.from(bytes.subarray(0, 8))).toEqual(PNG_MAGIC);

    // IHDR is the first chunk and reports the requested dimensions + RGB@8-bit.
    const ihdr = parseIhdr(bytes);
    expect(ihdr.chunkType).toBe("IHDR");
    expect(ihdr.width).toBe(width);
    expect(ihdr.height).toBe(height);
    expect(ihdr.bitDepth).toBe(8);
    expect(ihdr.colourType).toBe(2);

    // Ends with the IEND chunk (length 0 + "IEND" + CRC).
    const tail = bytes.subarray(bytes.length - 8, bytes.length - 4);
    expect(String.fromCharCode(...tail)).toBe("IEND");
  });

  it("is deterministic for the same inputs", () => {
    const opts = {
      width: 16,
      height: 16,
      pixel: (x: number, y: number) => ({ r: x, g: y, b: 0 }),
    };
    expect(Array.from(encodePng(opts))).toEqual(Array.from(encodePng(opts)));
  });
});

describe("fake chapter image model (ADR-007: no codec)", () => {
  const request = {
    dimensions: { width: 1600, height: 1200 },
    seed: 4242,
    artBibleVersion: "mvp-1",
  } as unknown as ImageSceneRequest;

  // The fake ignores the route; a minimal stub satisfies the two-arg port.
  const route = {
    capability: "routine-chapter-illustration",
    version: "mvp-image-routes-v1",
    target: "fake/scene",
    costMinorUnitsPerImage: 0,
  } as const;

  it("returns a decodable PNG that passes technical validation", async () => {
    const model = createFakeChapterImageModel();
    const generated = await model.generate(request, route);

    expect(generated.contentType).toBe("image/png");
    expect(Array.from(generated.bytes.subarray(0, 8))).toEqual(PNG_MAGIC);

    const ihdr = parseIhdr(generated.bytes);
    expect(ihdr.chunkType).toBe("IHDR");
    expect(ihdr.width).toBe(generated.width);
    expect(ihdr.height).toBe(generated.height);

    // The reported dimensions preserve the requested 4:3 (landscape) ratio, so the
    // pure-JS output flows through the real technical validator unchanged.
    expect(() =>
      assertTechnicalImage(
        {
          bytes: generated.bytes,
          contentType: generated.contentType,
          width: generated.width,
          height: generated.height,
        },
        "landscape",
      ),
    ).not.toThrow();
  });

  it("is deterministic per seed and diverges on a repair attempt", async () => {
    const model = createFakeChapterImageModel();
    const a = await model.generate(request, route);
    const b = await model.generate(request, route);
    expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes));

    const repaired = await model.generate(
      {
        ...request,
        repairInstruction: "make the child clearly the same person",
      } as unknown as ImageSceneRequest,
      route,
    );
    expect(Array.from(repaired.bytes)).not.toEqual(Array.from(a.bytes));
  });
});
