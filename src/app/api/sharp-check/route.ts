import { NextResponse } from "next/server";

// TEMP diagnostic (to be removed): exercise sharp in a normal serverless
// function to confirm whether the native libvips binary loads on Vercel.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { loadSharp } = await import("@/adapters/images/load-sharp");
    const sharp = await loadSharp();
    const png = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    return NextResponse.json({ ok: true, bytes: png.length });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      name: (e as { name?: string })?.name,
      message: (e instanceof Error ? e.message : String(e)).slice(0, 500),
    });
  }
}
