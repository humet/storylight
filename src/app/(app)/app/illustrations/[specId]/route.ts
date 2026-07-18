import "server-only";

import { z } from "zod";

import { requireActor } from "@/adapters/auth/require-actor";
import { isDomainError } from "@/lib/errors";
import { getIllustrationService } from "../service";

/**
 * Authorized chapter-illustration delivery (`docs/04-frontend/story-reader.md`
 * "Use responsive derivatives"; "Never show quarantined or rejected images"). The
 * SERVICE enforces ownership + the approved-only state filter, so anything the
 * actor may not see — a pending, manual-review, failed, or another family's
 * illustration — resolves to a uniform 404. The private storage key never leaves
 * the server and no permanent/signed URL is stored. `?w=` selects the responsive
 * derivative width.
 */
export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ specId: z.uuid() });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ specId: string }> },
): Promise<Response> {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) return notFound();

  const widthParam = new URL(request.url).searchParams.get("w");
  const maxWidth =
    widthParam && /^\d{1,5}$/.test(widthParam) ? Number(widthParam) : undefined;

  let actor;
  try {
    actor = await requireActor();
  } catch (error) {
    if (isDomainError(error) && error.code === "UNAUTHORISED")
      return notFound();
    throw error;
  }

  const service = await getIllustrationService();
  const image = await service.resolveDeliverableIllustration(
    actor,
    parsed.data.specId,
    maxWidth,
  );
  if (!image) return notFound();

  return new Response(image.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": image.contentType,
      // Private family content: never cached by shared caches, never persisted.
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}
