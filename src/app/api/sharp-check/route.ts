import { NextResponse } from "next/server";

// TEMP diagnostic (to be removed): exercise a WASM image codec (@jsquash) in a
// Vercel serverless function to confirm it works under Turbopack before
// migrating the image adapters off sharp.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { encode: encodeWebp } = await import("@jsquash/webp");
    const { encode: encodeAvif } = await import("@jsquash/avif");
    const resize = (await import("@jsquash/resize")).default;

    const w = 16;
    const h = 16;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 120;
      data[i + 1] = 90;
      data[i + 2] = 60;
      data[i + 3] = 255;
    }
    const src = { data, width: w, height: h } as ImageData;

    const resized = await resize(src, { width: 8, height: 8 });
    const webp = await encodeWebp(resized, { quality: 72 });
    const avif = await encodeAvif(resized, { quality: 55 });

    return NextResponse.json({
      ok: true,
      webpBytes: webp.byteLength,
      avifBytes: avif.byteLength,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      name: (e as { name?: string })?.name,
      message: (e instanceof Error ? e.message : String(e)).slice(0, 500),
    });
  }
}
