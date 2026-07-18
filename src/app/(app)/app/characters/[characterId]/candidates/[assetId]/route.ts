import { deliverAsset } from "../../deliver-asset";

/**
 * Authorized preview of a QUARANTINED candidate asset for the parent approval UI
 * (`character:manage`). Streams bytes only for `quarantined` candidates the actor
 * owns; approved/rejected/retired assets and other families are 404. This keeps
 * candidate review separate from reader delivery while rejected bytes stay
 * unreachable from both.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ characterId: string; assetId: string }> },
): Promise<Response> {
  const { characterId, assetId } = await params;
  return deliverAsset("candidate", characterId, assetId);
}
