import type { WebhookEventType } from "./enums";

/**
 * Mirrors the API surface of `backend/src/contracts/events.ts`.
 *
 * Only the stored-event summary is here. The `NormalizedEvent` shape and the
 * engine's variable bag are backend internals — the frontend never sees Meta's
 * raw payload, and nothing in the UI should be reasoning about event
 * normalization.
 */
export interface WebhookEventSummary {
  id: string;
  eventType: WebhookEventType;
  eventId: string;
  processed: boolean;
  processedAt: string | null;
  /** Populated when processing failed; the event stays unprocessed. */
  error: string | null;
  /**
   * How many workflow runs this event produced. Zero against a received
   * comment is the diagnosis the Activity page exists to deliver: the event
   * arrived and nothing matched it.
   */
  executionCount: number;
  summary: string;
  receivedAt: string;
}
