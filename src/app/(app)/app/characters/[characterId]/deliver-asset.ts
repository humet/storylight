import "server-only";

import { requireActor } from "@/adapters/auth/require-actor";
import type { DeliveryKind } from "@/application/visual-character-service";
import { DeliverAssetParamsSchema } from "@/application/visual-character-schemas";
import { isDomainError } from "@/lib/errors";
import { getVisualCharacterService } from "../visual-service";

/**
 * Shared handler for the two authorized asset-delivery routes
 * (`docs/05-backend/storage.md` "Signed URLs" — here, authorized streaming). The
 * SERVICE enforces ownership + the state filter for the requested `kind`:
 *  - `approved`  → only approved reference assets (reader delivery);
 *  - `candidate` → only quarantined candidates (parent review).
 * Anything the actor may not see resolves to a uniform 404 — no raw key, no
 * permanent URL, and rejected/retired bytes are unreachable from both routes.
 */
export async function deliverAsset(
  kind: DeliveryKind,
  characterId: string,
  assetId: string,
): Promise<Response> {
  const parsed = DeliverAssetParamsSchema.safeParse({ characterId, assetId });
  if (!parsed.success) return notFound();

  let actor;
  try {
    actor = await requireActor();
  } catch (error) {
    if (isDomainError(error) && error.code === "UNAUTHORISED")
      return notFound();
    throw error;
  }

  const service = await getVisualCharacterService();
  const asset = await service.resolveDeliverableAsset(
    actor,
    parsed.data.characterId,
    parsed.data.assetId,
    kind,
  );
  if (!asset) return notFound();

  return new Response(asset.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": asset.contentType,
      // Private family content: never cached by shared caches, never persisted.
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      // Defence for SVG placeholders if ever opened directly: no scripts.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}
