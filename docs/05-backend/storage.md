# Object Storage

## Purpose

Store private character references, generated images, approved originals, and responsive derivatives.

## Requirements

Storage must support:

- private objects
- signed delivery
- server-side upload
- metadata
- content-type enforcement
- deletion
- checksum verification
- lifecycle policies

The implementation may use Vercel Blob or another S3-compatible private store behind a Storylight port.

## Key structure

Use non-guessable IDs rather than names:

```text
families/{familyId}/characters/{characterId}/profiles/{version}/{assetId}
families/{familyId}/stories/{storyId}/chapters/{chapterId}/illustrations/{revisionId}
```

Do not expose raw keys directly to clients.

## Asset states

- quarantined
- approved
- rejected
- retired
- deletion-pending

Only approved assets can receive reader delivery URLs.

## Upload pipeline

```text
Provider bytes
→ MIME and decode validation
→ checksum
→ private upload
→ asset record
→ review
→ approved derivatives
```

## Derivatives

Create AVIF and WebP derivatives at useful widths. Preserve the original approved asset.

## Signed URLs

Reader services create short-lived signed URLs or an authorised image proxy response.

Do not store permanent signed URLs in the database.

## Retention

- Approved story assets: retained until family deletion or explicit story deletion.
- Rejected generations: short retention for debugging, then delete.
- Raw provider payloads: do not retain unless required.
- Evaluation synthetic assets: separate retention policy.

## Security

- No public buckets for family content.
- Validate ownership server-side.
- Prevent path traversal.
- Scan uploaded user files if photo uploads are ever introduced.
- Log asset IDs, not signed URLs.

## Acceptance criteria

- Rejected images are inaccessible.
- Deleting a family removes all private assets and derivatives.
- Reader thumbnails do not download full originals.
