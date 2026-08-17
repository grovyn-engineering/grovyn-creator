import type { ExecutionMode, NormalizedEvent } from "../contracts/index.js";
import {
  likeCommentConfigSchema,
  replyToCommentConfigSchema,
  sendDirectMessageConfigSchema,
} from "../contracts/index.js";
import { logger } from "../config/logger.js";
import { getProvider } from "../modules/instagram/instagram.provider.js";
import { getAccessTokenFor } from "../modules/instagram/instagram.token.service.js";
import { interpolate } from "./variables.js";

/**
 * Action executors.
 *
 * Each takes a validated configuration plus the event context and performs one
 * side effect through the provider interface. Adding an action means adding a
 * Zod variant in contracts, a case here, and a builder control — no migration,
 * and nothing else in the engine changes.
 */

export interface ActionContext {
  workspaceId: string;
  instagramAccountId: string;
  variables: Record<string, string>;
  event: NormalizedEvent;
  mode: ExecutionMode;
}

export interface ActionOutcome {
  /** Provider-side id of whatever was created. */
  externalId?: string;
  /** True when the action deliberately did nothing. Not a failure. */
  skipped?: boolean;
  skipReason?: string;
}

export async function executeAction(
  action: { actionType: string; configuration: unknown },
  context: ActionContext
): Promise<ActionOutcome> {
  switch (action.actionType) {
    case "REPLY_TO_COMMENT":
      return replyToComment(action.configuration, context);
    case "SEND_DIRECT_MESSAGE":
      return sendDirectMessage(action.configuration, context);
    case "LIKE_COMMENT":
      return likeComment(action.configuration, context);
    default:
      // A row whose actionType the code does not know — only reachable if the
      // enum gained a member without an executor. Recorded as a failure rather
      // than silently succeeding.
      throw new Error(`No executor for action type ${action.actionType}`);
  }
}

/**
 * A dry run stops here: matching and evaluation have already happened for
 * real, and only the outbound call is suppressed. That is what makes the test
 * button honest — it exercises the same code path production does.
 */
function dryRun(context: ActionContext, what: string): ActionOutcome | null {
  if (context.mode !== "DRY_RUN") return null;
  return { skipped: true, skipReason: `Test run — would have ${what}.` };
}

async function replyToComment(
  rawConfig: unknown,
  context: ActionContext
): Promise<ActionOutcome> {
  const config = replyToCommentConfigSchema.parse(rawConfig);

  if (context.event.payload.type !== "COMMENT") {
    return { skipped: true, skipReason: "This event is not a comment." };
  }

  const { text, unresolved } = interpolate(config.message, context.variables);
  if (unresolved.length > 0) {
    logger.warn({ unresolved }, "message had unresolved placeholders");
  }
  if (!text) {
    return { skipped: true, skipReason: "The reply would have been empty." };
  }

  const simulated = dryRun(context, `reply “${text}”`);
  if (simulated) return simulated;

  const accessToken = await getAccessTokenFor(context.instagramAccountId);
  const reply = await getProvider().replyToComment({
    accessToken,
    commentId: context.event.payload.commentId,
    message: text,
  });

  return { externalId: reply.id };
}

/**
 * Sends a DM, choosing the addressing mode from the event that triggered it.
 *
 * This split is the difference between the product working and not working.
 * Meta's 24-hour messaging window means a normal DM only reaches someone who
 * messaged the account within the last day — which a person who just left a
 * comment almost never has. Sending "comment PRICE and I'll DM you" through
 * the normal endpoint fails on essentially every real comment.
 *
 * Meta's answer is the private reply: addressed by comment id, valid for 7
 * days after the comment, and allowed exactly once per comment. So a comment
 * trigger takes that path, and a message trigger — where the window is open by
 * definition, because they just messaged — takes the normal one.
 */
async function sendDirectMessage(
  rawConfig: unknown,
  context: ActionContext
): Promise<ActionOutcome> {
  const config = sendDirectMessageConfigSchema.parse(rawConfig);

  const { text } = interpolate(config.message, context.variables);
  if (!text) return { skipped: true, skipReason: "The message would have been empty." };

  const event = context.event.payload;

  if (event.type === "COMMENT" || event.type === "MENTION") {
    const commentId = event.type === "COMMENT" ? event.commentId : event.mentionId;

    const simulated = dryRun(context, `privately reply “${text}” to the commenter`);
    if (simulated) return simulated;

    const accessToken = await getAccessTokenFor(context.instagramAccountId);
    const reply = await getProvider().sendPrivateReply({ accessToken, commentId, message: text });
    return { externalId: reply.id };
  }

  const recipientId = recipientFor(context.event);
  if (!recipientId) {
    // Instagram omits the sender id on some payloads. Without it there is
    // nobody to message, and that is a legitimate skip rather than an error.
    return { skipped: true, skipReason: "This event does not identify who to message." };
  }

  const simulated = dryRun(context, `send “${text}”`);
  if (simulated) return simulated;

  const accessToken = await getAccessTokenFor(context.instagramAccountId);
  const message = await getProvider().sendDirectMessage({ accessToken, recipientId, message: text });

  return { externalId: message.id };
}

function recipientFor(event: NormalizedEvent): string | null {
  switch (event.payload.type) {
    case "COMMENT":
      return event.payload.author.id ?? null;
    case "MESSAGE":
      return event.payload.sender.id ?? null;
    case "MENTION":
      return event.payload.author.id ?? null;
    default:
      return null;
  }
}

async function likeComment(rawConfig: unknown, context: ActionContext): Promise<ActionOutcome> {
  likeCommentConfigSchema.parse(rawConfig);

  if (context.event.payload.type !== "COMMENT") {
    return { skipped: true, skipReason: "This event is not a comment." };
  }

  const simulated = dryRun(context, "liked the comment");
  if (simulated) return simulated;

  const accessToken = await getAccessTokenFor(context.instagramAccountId);
  await getProvider().likeComment({ accessToken, commentId: context.event.payload.commentId });

  return {};
}
