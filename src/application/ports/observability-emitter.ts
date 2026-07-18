import type { StructuredEvent } from "@/domain/observability";

/**
 * PORT for emitting structured observability events (`observability.md`). The
 * application emits {@link StructuredEvent}s at command/stage/publication
 * boundaries; the adapter decides where they go (structured stdout in MVP; a
 * vendor sink later — a documented deferral). Kept a port so provider SDKs never
 * leak into the application (domain rule 12) and tests can assert emissions.
 */
export interface ObservabilityEmitter {
  emit(event: StructuredEvent): void;
}

/** A no-op emitter (the default when none is wired). */
export const noopEmitter: ObservabilityEmitter = {
  emit() {
    /* intentionally empty */
  },
};

/** A collecting emitter for tests. */
export function createCollectingEmitter(): ObservabilityEmitter & {
  events: StructuredEvent[];
} {
  const events: StructuredEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
    },
  };
}
