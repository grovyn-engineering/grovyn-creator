import type { NormalizedEvent, WebhookEventType } from "@socialpilot/contracts";
import type {
  CommentChangeValue,
  MessagingEvent,
  WebhookBody,
  WebhookEntry,
} from "../modules/instagram/instagram.types.js";

/**
 * Meta's webhook payload → the product's normalized event.
 *
 * This is the only function that understands Meta's wire format. Everything
 * downstream — the engine, conditions, actions, the activity feed — consumes
 * `NormalizedEvent` and would not change if Instagram restructured its
 * payloads tomorrow.
 *
 * One payload can carry several entries, each with several changes, so this
 * returns an array. Meta batches aggressively during a redelivery burst.
 */

/**
 * The idempotency key.
 *
 * Derived only from identifiers Meta assigns and re-sends unchanged on a
 * redelivery. It must never include a receipt timestamp, a random value, or
 * anything else that varies between deliveries of the same change — that would
 * make each redelivery look like a new event and defeat the unique constraint
 * the whole guarantee rests on.
 */
function eventIdFor(kind: string, platformId: string): string {
  return `ig:${kind}:${platformId}`;
}

function isoFrom(seconds: number | undefined, fallback: Date): string {
  if (!seconds || !Number.isFinite(seconds)) return fallback.toISOString();
  // Meta sends seconds for `entry.time` and milliseconds for messaging
  // timestamps. Anything past the year 2286 in seconds is really milliseconds.
  const ms = seconds > 1e11 ? seconds : seconds * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

export function normalizeWebhookBody(body: WebhookBody, receivedAt = new Date()): NormalizedEvent[] {
  if (!body || !Array.isArray(body.entry)) return [];

  const events: NormalizedEvent[] = [];
  for (const entry of body.entry) {
    events.push(...normalizeEntry(entry, receivedAt));
  }
  return events;
}

function normalizeEntry(entry: WebhookEntry, receivedAt: Date): NormalizedEvent[] {
  const recipientAccountId = String(entry.id ?? "");
  if (!recipientAccountId) return [];

  const occurredAt = isoFrom(entry.time, receivedAt);
  const events: NormalizedEvent[] = [];

  for (const change of entry.changes ?? []) {
    const event = normalizeChange(change.field, change.value, recipientAccountId, occurredAt);
    if (event) events.push(event);
  }

  for (const messaging of entry.messaging ?? []) {
    const event = normalizeMessaging(messaging, recipientAccountId, receivedAt);
    if (event) events.push(event);
  }

  return events;
}

function normalizeChange(
  field: string,
  value: Record<string, unknown>,
  recipientAccountId: string,
  occurredAt: string
): NormalizedEvent | null {
  const base = { platform: "INSTAGRAM" as const, recipientAccountId, occurredAt };

  if (field === "comments" || field === "live_comments") {
    const comment = value as unknown as CommentChangeValue;
    if (!comment.id) return null;

    return {
      ...base,
      eventId: eventIdFor("comment", comment.id),
      eventType: "COMMENT" satisfies WebhookEventType,
      payload: {
        type: "COMMENT",
        commentId: comment.id,
        text: comment.text ?? "",
        ...(comment.media?.id ? { postId: comment.media.id } : {}),
        ...(comment.parent_id ? { parentCommentId: comment.parent_id } : {}),
        author: {
          ...(comment.from?.id ? { id: comment.from.id } : {}),
          ...(comment.from?.username ? { username: comment.from.username } : {}),
        },
      },
    };
  }

  if (field === "mentions") {
    const mention = value as { comment_id?: string; media_id?: string; text?: string };
    const id = mention.comment_id ?? mention.media_id;
    if (!id) return null;

    return {
      ...base,
      eventId: eventIdFor("mention", id),
      eventType: "MENTION",
      payload: {
        type: "MENTION",
        mentionId: id,
        text: mention.text ?? "",
        ...(mention.media_id ? { postId: mention.media_id } : {}),
        author: {},
      },
    };
  }

  // Stored rather than dropped, so "we received it and had no trigger for it"
  // is distinguishable from "it never arrived" when diagnosing a silent workflow.
  const fallbackId = typeof value?.id === "string" ? value.id : `${recipientAccountId}:${occurredAt}`;
  return {
    ...base,
    eventId: eventIdFor(`other:${field}`, fallbackId),
    eventType: "UNKNOWN",
    payload: { type: "UNKNOWN", rawType: field },
  };
}

function normalizeMessaging(
  event: MessagingEvent,
  recipientAccountId: string,
  receivedAt: Date
): NormalizedEvent | null {
  const message = event.message;
  if (!message?.mid) return null;

  // Echoes are the account's own outbound messages reflected back. Processing
  // them would let a workflow that sends a DM trigger itself — an infinite loop
  // that costs real API quota and spams a real person.
  if (message.is_echo) return null;
  if (message.is_deleted) return null;

  const senderId = event.sender?.id;

  return {
    platform: "INSTAGRAM",
    recipientAccountId,
    occurredAt: isoFrom(event.timestamp, receivedAt),
    eventId: eventIdFor("message", message.mid),
    eventType: "MESSAGE",
    payload: {
      type: "MESSAGE",
      messageId: message.mid,
      text: message.text ?? "",
      ...(senderId ? { conversationId: senderId } : {}),
      sender: { ...(senderId ? { id: senderId } : {}) },
    },
  };
}

/**
 * One-line human summary for the activity feed. Truncated hard — this appears
 * in a list, and a 2000-character comment would break the layout.
 */
export function summarize(event: NormalizedEvent): string {
  const clip = (text: string, max = 90): string =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text;

  switch (event.payload.type) {
    case "COMMENT": {
      const who = event.payload.author.username ? `@${event.payload.author.username}` : "Someone";
      return event.payload.text
        ? `${who} commented “${clip(event.payload.text)}”`
        : `${who} commented`;
    }
    case "MESSAGE": {
      const who = event.payload.sender.username ? `@${event.payload.sender.username}` : "Someone";
      return event.payload.text ? `${who} sent “${clip(event.payload.text)}”` : `${who} sent a message`;
    }
    case "MENTION": {
      const who = event.payload.author.username ? `@${event.payload.author.username}` : "Someone";
      return `${who} mentioned you`;
    }
    case "UNKNOWN":
      return `Received a ${event.payload.rawType} event`;
  }
}
