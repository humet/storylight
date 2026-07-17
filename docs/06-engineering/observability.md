# Observability

## Purpose

Make workflow failures, quality regressions, cost, and latency diagnosable without logging private family content broadly.

## Correlation

Every command receives:

- request ID
- workflow ID
- family ID
- story or series ID
- chapter ID where applicable
- generation run ID

## Structured events

Emit:

- workflow created
- stage started
- stage completed
- retry
- fallback
- validation failure
- review decision
- revision requested
- continuity rejected
- chapter published
- image approved
- workflow failed

## Metrics

- workflow success rate
- stage latency
- p95 time to approved text
- p95 time to first image
- retry rate
- fallback rate
- review revision rate
- continuity rejection rate
- identity failure rate
- accepted-result cost
- provider availability

## Logs

Do not log:

- full story prose
- raw prompts
- child profile details
- signed asset URLs
- image bytes
- provider reasoning traces

Log IDs and safe issue codes.

## Tracing

Trace across:

- Server Action or Route Handler
- workflow dispatcher
- job worker
- model adapter
- storage
- publication transaction

## Alerts

Alert on:

- sustained workflow failures
- safety failures
- duplicate publication attempt
- high continuity rejection
- image identity regression
- provider deprecation
- cost budget breach
- job backlog

## Dashboards

Separate:

- production operations
- AI quality
- image quality
- cost
- evaluations

## Acceptance criteria

- A failed bedtime generation can be diagnosed by correlation ID.
- Diagnosis does not require exposing private story content in general logs.
