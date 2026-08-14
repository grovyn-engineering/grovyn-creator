import { normalizedEventSchema } from "../contracts/index.js";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { runEvent } from "../engine/engine.js";

/**
 * Turns a stored webhook event into workflow executions.
 *
 * Runs on a worker (or inline when no Redis is configured), never inside the
 * webhook request. Everything here is allowed to be slow — it makes outbound
 * calls to Meta.
 */

/** Beyond this an event is not retried again. See the note on poison events below. */
const MAX_ATTEMPTS = 5;

export async function processWebhookEventById(webhookEventId: string): Promise<void> {
  const event = await prisma.webhookEvent.findUnique({
    where: { id: webhookEventId },
    select: {
      id: true,
      processed: true,
      attempts: true,
      workspaceId: true,
      instagramAccountId: true,
      normalized: true,
    },
  });

  if (!event) {
    logger.warn({ webhookEventId }, "webhook event vanished before processing");
    return;
  }

  // A second guard on top of the queue's own deduplication. Either the queue
  // redelivered, or an inline run raced a worker.
  if (event.processed) return;

  if (!event.workspaceId || !event.instagramAccountId) {
    // Nothing to run it against. Marked processed so it stops being retried.
    await markProcessed(event.id, "unroutable");
    return;
  }

  if (event.attempts >= MAX_ATTEMPTS) {
    // A payload the normalizer or engine cannot handle fails identically every
    // time. Retrying forever would occupy a worker permanently; the row stays
    // in the database either way, so nothing is lost by stopping.
    logger.error({ webhookEventId }, "webhook event exceeded retry budget; giving up");
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { error: "Exceeded retry budget", processed: true, processedAt: new Date() },
    });
    return;
  }

  // Parsed rather than cast: this JSON was written by a possibly older version
  // of the normalizer, and an engine that trusted its shape would crash on a
  // field that has since changed.
  const parsed = normalizedEventSchema.safeParse(event.normalized);
  if (!parsed.success) {
    logger.error({ webhookEventId }, "stored event does not match the normalized schema");
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { error: "Event could not be interpreted", processed: true, processedAt: new Date() },
    });
    return;
  }

  await prisma.webhookEvent.update({
    where: { id: event.id },
    data: { attempts: { increment: 1 } },
  });

  try {
    const result = await runEvent(
      {
        workspaceId: event.workspaceId,
        instagramAccountId: event.instagramAccountId,
        event: parsed.data,
      },
      { webhookEventId: event.id }
    );

    await markProcessed(event.id);

    logger.info(
      { webhookEventId: event.id, ...result, executionIds: undefined },
      "processed webhook event"
    );
  } catch (error) {
    // Left unprocessed on purpose, so the queue's retry picks it up.
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { error: error instanceof Error ? error.message : String(error) },
    });
    logger.error({ err: error, webhookEventId: event.id }, "failed to process webhook event");
    throw error;
  }
}

async function markProcessed(id: string, note?: string): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id },
    data: { processed: true, processedAt: new Date(), error: note ?? null },
  });
}
