import { deliverAsset } from "../../deliver-asset";

/**
 * Authorized delivery of an APPROVED character reference asset to a family
 * member (`docs/05-backend/storage.md`). Streams bytes only for `approved`
 * assets the actor may read; everything else is 404. Never a permanent URL.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ characterId: string; assetId: string }> },
): Promise<Response> {
  const { characterId, assetId } = await params;
  return deliverAsset("approved", characterId, assetId);
}
