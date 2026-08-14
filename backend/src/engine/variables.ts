import type { EventVariables, NormalizedEvent } from "../contracts/index.js";

/**
 * Turns a normalized event into the flat string map that conditions read and
 * `{{placeholder}}` interpolation resolves against.
 *
 * Flat and string-valued on purpose. Both consumers then need only a map
 * lookup — no path walking over a user-supplied string, which is where an
 * expression evaluator would start growing a way to reach `constructor` and
 * become an injection surface.
 */
export function buildVariables(event: NormalizedEvent): EventVariables {
  const vars: EventVariables = {
    "event.type": event.eventType,
    "event.occurred_at": event.occurredAt,
  };

  const payload = event.payload;

  switch (payload.type) {
    case "COMMENT":
      vars["comment.text"] = payload.text;
      vars["comment.id"] = payload.commentId;
      if (payload.postId) vars["comment.post_id"] = payload.postId;
      if (payload.author.username) vars["comment.author_username"] = payload.author.username;
      if (payload.author.id) vars["comment.author_id"] = payload.author.id;
      if (payload.author.name) vars["comment.author_name"] = payload.author.name;
      break;

    case "MESSAGE":
      vars["message.text"] = payload.text;
      vars["message.id"] = payload.messageId;
      if (payload.conversationId) vars["message.conversation_id"] = payload.conversationId;
      if (payload.sender.username) vars["message.sender_username"] = payload.sender.username;
      if (payload.sender.id) vars["message.sender_id"] = payload.sender.id;
      break;

    case "MENTION":
      vars["mention.text"] = payload.text;
      vars["mention.id"] = payload.mentionId;
      if (payload.postId) vars["mention.post_id"] = payload.postId;
      if (payload.author.username) vars["mention.author_username"] = payload.author.username;
      break;

    case "UNKNOWN":
      break;
  }

  // A single alias so a message body can say "Hi {{username}}" without the
  // author having to know which event type they are writing for.
  const username =
    vars["comment.author_username"] ?? vars["message.sender_username"] ?? vars["mention.author_username"];
  if (username) vars["username"] = username;

  return vars;
}

/** `{{ name }}` — whitespace tolerated, since people type it. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * Substitutes placeholders in a message body.
 *
 * An unresolved placeholder is replaced with an empty string rather than left
 * as literal `{{username}}`. A public reply reading "Hi {{username}}" is a
 * visible, embarrassing failure on the customer's own feed; a slightly awkward
 * "Hi" is not. The engine records which names went unresolved so the execution
 * detail can show it.
 */
export function interpolate(
  template: string,
  variables: Readonly<EventVariables>
): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];

  const text = template.replace(PLACEHOLDER, (_match, rawName: string) => {
    const name = rawName.trim();

    // `Object.hasOwn`, not a plain lookup. A bare `variables[name]` walks the
    // prototype chain, so `{{constructor}}` resolves to the Object constructor
    // and `{{toString}}` to a native function — both of which would then be
    // stringified straight into a public Instagram reply. The names come from
    // a user-authored template, so this is reachable input, not a theoretical
    // concern.
    if (!Object.hasOwn(variables, name)) {
      unresolved.push(name);
      return "";
    }

    return variables[name] ?? "";
  });

  // Interpolation can leave double spaces where a placeholder vanished.
  return { text: text.replace(/[ \t]{2,}/g, " ").trim(), unresolved };
}

/** The names offered by the workflow builder's variable picker. */
export const AVAILABLE_VARIABLES: Record<string, readonly string[]> = {
  COMMENT_RECEIVED: [
    "comment.text",
    "comment.author_username",
    "comment.post_id",
    "username",
  ],
  MESSAGE_RECEIVED: ["message.text", "message.sender_username", "username"],
  MENTION_RECEIVED: ["mention.text", "mention.author_username", "username"],
};
