import "server-only";

import type { ObservabilityEmitter } from "@/application/ports/observability-emitter";

/**
 * The default {@link ObservabilityEmitter}: structured single-line JSON to stdout,
 * safe to ship to any log aggregator. It logs ONLY what `buildEvent` already made
 * safe (IDs + safe codes + numeric measures) — no prose, prompts, profiles, signed
 * URLs, bytes, or provider traces (`observability.md` "Do not log"). Routing these
 * lines to a vendor dashboard is a deployment concern (documented deferral).
 */
export function createConsoleObservabilityEmitter(): ObservabilityEmitter {
  return {
    emit(event) {
      // A single structured line, prefixed so it is greppable and clearly a
      // Storylight observability event.
      process.stdout.write(`storylight.event ${JSON.stringify(event)}\n`);
    },
  };
}
