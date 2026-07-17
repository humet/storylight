# Background Jobs and Durable Workflows

## Purpose

Story and image generation outlast ordinary HTTP requests. Work must continue when the browser closes or a deployment occurs.

## Requirements

The job system must support:

- durable execution
- retries with backoff
- scheduled retry
- idempotency
- concurrency limits
- visibility timeout or lease
- cancellation where safe
- dead-letter handling
- workflow correlation
- observability

The concrete provider may be selected during implementation, but all application code uses a `JobDispatcher` port.

## Job types

- create-one-off-story
- create-series
- generate-chapter
- regenerate-chapter
- generate-illustration
- review-illustration
- create-derivatives
- delete-family-assets
- run-capability-probe
- run-evaluation-case

## Job payloads

Payloads contain IDs and command metadata, not large prose or image bytes.

Workers reload canonical state from the database.

## Idempotency

Every job checks the workflow and stage output before provider invocation.

## Concurrency

Limits:

- one active chapter generation per series and chapter number
- bounded image generations per family
- bounded global provider concurrency
- evaluation traffic isolated from bedtime production traffic

## Retry

Retry temporary failures:

- timeout
- rate limit
- temporary network issue
- storage transient

Do not blindly retry:

- safety rejection
- corrupt canonical data
- invalid chapter number
- repeated review failure
- missing character references

## Dead letter

After retries are exhausted, mark the workflow failed with a safe error code and preserve resumable state.

## Progress

Workers emit stage events used by polling or SSE.

## Acceptance criteria

- Browser closure does not cancel generation.
- Deployment does not lose workflow state.
- Duplicate jobs do not create duplicate provider cost.
- Dead jobs are visible and recoverable.
