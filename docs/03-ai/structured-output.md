# Structured Output

## Purpose

Every model result is untrusted external input. Valid JSON is not sufficient; Storylight requires schema validation and domain validation.

## Layers

1. Command schemas
2. AI wire schemas
3. Normalised domain schemas
4. Persistence schemas

Never derive an AI output schema directly from a database table.

## AI SDK usage

Use the current Vercel AI SDK structured-output API through `generateText` and `Output.object`.

```ts
const result = await generateText({
  model,
  system,
  prompt,
  output: Output.object({
    name: "StorylightChapterDraft",
    description: "A complete chapter following the supplied plan.",
    schema: ChapterDraftWireSchemaV1,
  }),
});
```

Do not use deprecated object-generation APIs in new code.

## Zod rules

- Use Zod v4.
- Prefer strict objects.
- Bound every generated string.
- Bound every array.
- Use enums for closed vocabularies.
- Avoid coercion and defaults in wire schemas.
- Use nullable values consistently.
- Keep transformations out of provider-facing schemas.

## IDs

Models never generate database IDs.

Use local semantic keys:

```ts
const StoryKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,63}$/);
```

After validation, map keys to application-generated IDs.

## Versioning

Every root AI artifact contains `schemaVersion`.

Published schema versions are immutable.

Store schema version separately from prompt version and model route version.

## Validation pipeline

```text
Provider output
→ SDK parsing
→ Wire-schema validation
→ Normalisation
→ Cross-reference validation
→ Domain validation
→ Persistence
```

## Repair

Bounded repair strategy:

1. Classify failure.
2. Apply syntax repair only when no semantic content must be invented.
3. Use one model repair for a local schema problem.
4. Fully regenerate when output is truncated or structurally wrong.
5. Stop at the workflow budget.

Continuity extraction should favour regeneration over aggressive repair.

## Canonical calculations

Application code calculates:

- word count
- read time
- IDs
- timestamps
- continuity snapshots
- final review decision
- route metadata

## Security

Do not place full model output in ordinary logs. Treat story content and child-related data as private.

## Acceptance criteria

- Every model stage has a versioned wire schema.
- Unknown references are rejected.
- Review models cannot override deterministic policy.
- Historical artifacts remain parseable by their recorded version.
