# Database Architecture

## Decision

Use Postgres with Drizzle ORM.

Postgres provides transactions, constraints, JSON support, indexing, and mature operational tooling. Drizzle keeps schema and queries explicit and TypeScript-friendly.

## Principles

- Database constraints guarantee correctness.
- Application locks improve experience but do not replace uniqueness constraints.
- Published content is revisioned.
- Workflow and generation history are append-oriented.
- Large binary assets live in object storage.

## Core tables

### Identity and family

- users
- families
- family_members
- child_characters
- character_profile_versions
- character_relationships
- character_outfits
- character_long_term_memories

### Visual assets

- visual_assets
- character_reference_assets
- art_bibles
- art_bible_versions
- world_visual_profiles
- location_visual_profiles
- story_visual_profiles
- image_derivatives

### Stories

- stories
- series_bibles
- chapter_blueprints
- chapters
- chapter_revisions
- chapter_publications
- story_preferences
- story_favourites
- reading_progress

### Continuity

- continuity_snapshots
- continuity_facts
- plot_threads
- plot_thread_states

### Illustrations

- illustration_specs
- illustration_revisions
- illustration_reviews
- illustration_publications

### Workflows and AI

- workflow_executions
- workflow_stage_outputs
- generation_runs
- model_route_versions
- prompt_versions
- schema_versions
- evaluation_approvals

### Feedback

- story_feedback
- illustration_feedback

## Key constraints

```text
UNIQUE(family_id, character_key)
UNIQUE(series_id, chapter_number, accepted)
UNIQUE(series_id, chapter_number, revision_number)
UNIQUE(user_id, request_id, workflow_type)
UNIQUE(illustration_spec_id, revision_number)
```

Use partial unique indexes where the database supports them for one accepted revision per chapter.

## Transactions

Chapter publication transaction:

- create accepted chapter revision
- create continuity snapshot
- advance series progress
- create publication record

Illustration jobs dispatch after commit.

## JSON usage

JSONB is appropriate for:

- validated generation snapshots
- model metadata
- structured domain payloads that retain schema versions

Frequently queried fields belong in typed columns.

Do not use one giant JSON story record.

## Deletion

Family deletion must remove or anonymise:

- child profiles
- story prose
- visual references
- generated images
- raw model outputs
- signed storage access

Use an auditable deletion workflow.

## Migrations

All schema changes use committed Drizzle migrations. Production deployments run migrations as a controlled step, not implicitly from application startup.

## Acceptance criteria

- Database constraints prevent duplicate chapter publication.
- Every published artifact has lineage.
- Historical revisions remain queryable.
- Private child data can be deleted completely.
