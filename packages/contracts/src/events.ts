import { z } from "zod";
import { idSchema, isoDateSchema } from "./api.js";
import { socialPlatformSchema, webhookEventTypeSchema } from "./enums.js";

/**
 * The normalized event is the boundary between "whatever Meta sent" and the
 * rest of the product. The engine, the condition evaluator, and the action
 * executors only ever see this shape, which is why the engine has no Meta
 * types in it and can be unit-tested with a plain object.
 *
 * Adding a platform means writing a normalizer that produces this — nothing
 * downstream changes.
 */

/** Whoever caused the event. All fields optional: Meta omits plenty of them. */
export const eventActorSchema = z.object({
  /** Platform-scoped id of the person. */
  id: z.string().optional(),
  username: z.string().optional(),
  name: z.string().optional(),
});
export type EventActor = z.infer<typeof eventActorSchema>;

export const normalizedCommentSchema = z.object({
  type: z.literal("COMMENT"),
  /** Platform id of the comment. Required — it is what actions reply to. */
  commentId: z.string(),
  /** Platform id of the media the comment sits under. */
  postId: z.string().optional(),
  text: z.string(),
  /** Set when the comment is a reply to another comment. */
  parentCommentId: z.string().optional(),
  author: eventActorSchema,
});

export const normalizedMessageSchema = z.object({
  type: z.literal("MESSAGE"),
  messageId: z.string(),
  /** Thread the message belongs to; needed to send a reply back. */
  conversationId: z.string().optional(),
  text: z.string(),
  sender: eventActorSchema,
});

export const normalizedMentionSchema = z.object({
  type: z.literal("MENTION"),
  mentionId: z.string(),
  postId: z.string().optional(),
  text: z.string(),
  author: eventActorSchema,
});

/**
 * An event the product stores and acknowledges but has no trigger for.
 * Preserved rather than discarded so the raw payload is available when
 * diagnosing "why did nothing happen?".
 */
export const normalizedUnknownSchema = z.object({
  type: z.literal("UNKNOWN"),
  /** Meta's own field name for the change, e.g. `story_insights`. */
  rawType: z.string(),
});

export const normalizedEventPayloadSchema = z.discriminatedUnion("type", [
  normalizedCommentSchema,
  normalizedMessageSchema,
  normalizedMentionSchema,
  normalizedUnknownSchema,
]);
export type NormalizedEventPayload = z.infer<typeof normalizedEventPayloadSchema>;

export const normalizedEventSchema = z.object({
  /**
   * Stable, deterministic id derived from the platform's own identifiers.
   * This is the idempotency key: Meta redelivering the same change must
   * produce the same string, or the unique constraint cannot protect us.
   */
  eventId: z.string().min(1).max(200),
  platform: socialPlatformSchema,
  eventType: webhookEventTypeSchema,
  /** Instagram user id of the account that received the event. */
  recipientAccountId: z.string(),
  /** Meta's timestamp when supplied, otherwise receipt time. */
  occurredAt: isoDateSchema,
  payload: normalizedEventPayloadSchema,
});
export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;

/**
 * The flat variable bag the engine builds from a normalized event. Condition
 * fields read from it, and `{{placeholder}}` interpolation resolves against
 * it. Flat and string-valued on purpose: it makes both operations a map
 * lookup with no path walking over attacker-influenced input.
 */
export type EventVariables = Record<string, string>;

// ── Stored events (API surface) ──────────────────────────────────────────

/**
 * A stored webhook event as the activity page shows it. `payload` is the
 * normalized form, never Meta's raw body — the raw body is retained in the
 * database for diagnostics but is not an API response.
 */
export const webhookEventSummarySchema = z.object({
  id: idSchema,
  eventType: webhookEventTypeSchema,
  eventId: z.string(),
  processed: z.boolean(),
  processedAt: isoDateSchema.nullable(),
  /** Populated when processing failed; the event stays unprocessed. */
  error: z.string().nullable(),
  /** How many workflow runs this event produced. Zero means nothing matched. */
  executionCount: z.number().int().min(0),
  summary: z.string(),
  receivedAt: isoDateSchema,
});
export type WebhookEventSummary = z.infer<typeof webhookEventSummarySchema>;

export const listEventsQuerySchema = z.object({
  eventType: webhookEventTypeSchema.optional(),
  processed: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
});
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
