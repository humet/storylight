# Authentication and Authorisation

## Purpose

Storylight is a private family application. Authentication protects family stories, child profiles, and generated visual assets.

## MVP identity model

Support parent or guardian accounts.

Children do not receive independent public accounts in the MVP.

## Authentication provider

Keep authentication behind an application boundary so the provider can be replaced. The implementation may use a managed provider or a standards-based auth library, but domain code must depend on:

```ts
interface AuthenticatedActor {
  userId: string;
  familyIds: string[];
  roles: Array<"owner" | "parent" | "viewer">;
}
```

## Authorisation

Every query and command verifies family ownership or membership.

Never authorise only by possession of:

- story ID
- chapter ID
- asset ID
- signed URL from another session

## Roles

### Owner

- manage family
- manage billing later
- delete family
- manage all characters and stories

### Parent

- create and edit stories
- manage character profiles
- regenerate content
- change safety settings

### Viewer

- read approved stories
- cannot create or change child profiles

## Parent surface

Child-facing reading does not require a separate child login. Sensitive actions may require a lightweight parent gate, such as reauthentication or a parent code.

Do not present the parent gate as a security boundary stronger than the underlying account session.

## Sessions

- Secure, HTTP-only cookies
- CSRF protection
- sensible session expiry
- reauthentication for destructive deletion
- server-side identity resolution

## Asset access

Signed image delivery requires authorised server issuance. URLs should expire.

## Audit

Record high-impact actions:

- character approval
- safety setting change
- story deletion
- family deletion
- permanent memory change

## Acceptance criteria

- One family cannot access another family’s content by ID.
- Child profiles are never publicly enumerable.
- Destructive actions require appropriate role and confirmation.
