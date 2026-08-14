import { describe, expect, it } from "vitest";
import { normalizeWebhookBody, summarize } from "./normalizer.js";
import type { WebhookBody } from "../modules/instagram/instagram.types.js";

function commentPayload(overrides: Record<string, unknown> = {}): WebhookBody {
  return {
    object: "instagram",
    entry: [
      {
        id: "17841400000000000",
        time: 1_754_000_000,
        changes: [
          {
            field: "comments",
            value: {
              id: "comment_abc",
              text: "how much is this?",
              from: { id: "user_1", username: "curious_buyer" },
              media: { id: "post_xyz" },
              ...overrides,
            },
          },
        ],
      },
    ],
  };
}

describe("normalizeWebhookBody", () => {
  it("normalizes a comment change", () => {
    const [event] = normalizeWebhookBody(commentPayload());

    expect(event).toBeDefined();
    expect(event?.eventType).toBe("COMMENT");
    expect(event?.recipientAccountId).toBe("17841400000000000");
    expect(event?.payload).toMatchObject({
      type: "COMMENT",
      commentId: "comment_abc",
      text: "how much is this?",
      postId: "post_xyz",
      author: { id: "user_1", username: "curious_buyer" },
    });
  });

  /**
   * The idempotency guarantee rests entirely on this property. Meta redelivers
   * the same change after any failed acknowledgement, and the redelivery must
   * produce a byte-identical `eventId` or the unique constraint cannot
   * deduplicate it. Any receipt timestamp or random value in the derivation
   * would break this silently.
   */
  it("derives a stable eventId across redeliveries", () => {
    const first = normalizeWebhookBody(commentPayload(), new Date("2026-01-01T00:00:00Z"));
    const second = normalizeWebhookBody(commentPayload(), new Date("2026-06-15T12:34:56Z"));

    expect(first[0]?.eventId).toBe("ig:comment:comment_abc");
    expect(second[0]?.eventId).toBe(first[0]?.eventId);
  });

  it("gives different comments different event ids", () => {
    const a = normalizeWebhookBody(commentPayload({ id: "comment_a" }));
    const b = normalizeWebhookBody(commentPayload({ id: "comment_b" }));
    expect(a[0]?.eventId).not.toBe(b[0]?.eventId);
  });

  it("expands a batched payload into one event per change", () => {
    const body: WebhookBody = {
      object: "instagram",
      entry: [
        {
          id: "acct_1",
          time: 1_754_000_000,
          changes: [
            { field: "comments", value: { id: "c1", text: "one" } },
            { field: "comments", value: { id: "c2", text: "two" } },
          ],
        },
        {
          id: "acct_2",
          time: 1_754_000_001,
          changes: [{ field: "comments", value: { id: "c3", text: "three" } }],
        },
      ],
    };

    const events = normalizeWebhookBody(body);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.recipientAccountId)).toEqual(["acct_1", "acct_1", "acct_2"]);
  });

  /**
   * Echoes are the account's own outbound messages reflected back. Processing
   * one would let a workflow that sends a DM trigger itself — an unbounded loop
   * that burns API quota and spams a real person.
   */
  it("drops echo and deleted messages", () => {
    const body: WebhookBody = {
      object: "instagram",
      entry: [
        {
          id: "acct_1",
          time: 1_754_000_000,
          messaging: [
            { message: { mid: "m1", text: "our own reply", is_echo: true } },
            { message: { mid: "m2", text: "gone", is_deleted: true } },
            { sender: { id: "them" }, message: { mid: "m3", text: "a real message" } },
          ],
        },
      ],
    };

    const events = normalizeWebhookBody(body);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ type: "MESSAGE", messageId: "m3" });
  });

  it("keeps unrecognised change types as UNKNOWN rather than dropping them", () => {
    const body: WebhookBody = {
      object: "instagram",
      entry: [
        { id: "acct_1", time: 1_754_000_000, changes: [{ field: "story_insights", value: { id: "s1" } }] },
      ],
    };

    const [event] = normalizeWebhookBody(body);
    expect(event?.eventType).toBe("UNKNOWN");
    expect(event?.payload).toMatchObject({ type: "UNKNOWN", rawType: "story_insights" });
  });

  it("returns nothing for a malformed body instead of throwing", () => {
    expect(normalizeWebhookBody({ object: "instagram" } as WebhookBody)).toEqual([]);
    expect(normalizeWebhookBody(undefined as unknown as WebhookBody)).toEqual([]);
  });

  it("treats a millisecond timestamp as milliseconds", () => {
    const body: WebhookBody = {
      object: "instagram",
      entry: [
        {
          id: "acct_1",
          time: 1_754_000_000,
          messaging: [
            { sender: { id: "u" }, timestamp: 1_754_000_000_000, message: { mid: "m1", text: "hi" } },
          ],
        },
      ],
    };

    const [event] = normalizeWebhookBody(body);
    expect(event?.occurredAt).toBe(new Date(1_754_000_000_000).toISOString());
  });
});

describe("summarize", () => {
  it("describes a comment with its author", () => {
    const [event] = normalizeWebhookBody(commentPayload());
    expect(summarize(event!)).toBe('@curious_buyer commented “how much is this?”');
  });

  it("truncates long text", () => {
    const [event] = normalizeWebhookBody(commentPayload({ text: "x".repeat(500) }));
    expect(summarize(event!).length).toBeLessThan(140);
    expect(summarize(event!)).toContain("…");
  });
});
