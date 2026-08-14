import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../contracts/index.js";
import { buildVariables, interpolate } from "./variables.js";

const commentEvent: NormalizedEvent = {
  eventId: "ig:comment:c1",
  platform: "INSTAGRAM",
  eventType: "COMMENT",
  recipientAccountId: "acct_1",
  occurredAt: "2026-08-13T10:00:00.000Z",
  payload: {
    type: "COMMENT",
    commentId: "c1",
    postId: "p1",
    text: "what is the price?",
    author: { id: "u1", username: "buyer" },
  },
};

describe("buildVariables", () => {
  it("exposes the comment fields conditions can read", () => {
    const vars = buildVariables(commentEvent);
    expect(vars["comment.text"]).toBe("what is the price?");
    expect(vars["comment.post_id"]).toBe("p1");
    expect(vars["comment.author_username"]).toBe("buyer");
  });

  it("omits absent fields rather than defaulting them to empty strings", () => {
    // This is what makes the evaluator's fail-closed behaviour reachable: an
    // absent field must be absent from the bag, not present and empty.
    const vars = buildVariables({
      ...commentEvent,
      payload: { type: "COMMENT", commentId: "c1", text: "hi", author: {} },
    });

    expect(vars).not.toHaveProperty("comment.post_id");
    expect(vars).not.toHaveProperty("comment.author_username");
  });

  it("aliases the author to `username` regardless of event type", () => {
    expect(buildVariables(commentEvent)["username"]).toBe("buyer");

    const messageEvent: NormalizedEvent = {
      ...commentEvent,
      eventType: "MESSAGE",
      payload: {
        type: "MESSAGE",
        messageId: "m1",
        text: "hello",
        sender: { id: "u2", username: "asker" },
      },
    };
    expect(buildVariables(messageEvent)["username"]).toBe("asker");
  });
});

describe("interpolate", () => {
  const vars = { username: "buyer", "comment.text": "what is the price?" };

  it("substitutes placeholders", () => {
    expect(interpolate("Hi {{username}}, thanks!", vars).text).toBe("Hi buyer, thanks!");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(interpolate("Hi {{ username }}", vars).text).toBe("Hi buyer");
  });

  /**
   * An unresolved placeholder becomes nothing, not literal `{{username}}`.
   * A public reply reading "Hi {{username}}" is a visible failure on the
   * customer's own feed; a slightly terse "Hi" is not.
   */
  it("drops unresolved placeholders and reports them", () => {
    const result = interpolate("Hi {{missing}}, thanks!", vars);
    expect(result.text).toBe("Hi , thanks!");
    expect(result.unresolved).toEqual(["missing"]);
  });

  it("collapses the whitespace a vanished placeholder leaves behind", () => {
    expect(interpolate("Hi  {{missing}}  there", vars).text).toBe("Hi there");
  });

  it("leaves text without placeholders untouched", () => {
    const result = interpolate("No placeholders here", vars);
    expect(result.text).toBe("No placeholders here");
    expect(result.unresolved).toEqual([]);
  });

  /**
   * The variable bag is a flat map and lookup is a plain property read on a
   * string key, so a template cannot walk a prototype chain to reach anything.
   */
  it("does not resolve prototype properties", () => {
    const result = interpolate("{{constructor}} {{__proto__}} {{toString}}", vars);
    expect(result.text).toBe("");
    expect(result.unresolved).toEqual(["constructor", "__proto__", "toString"]);
  });
});
