import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { NormalizedEvent } from "@socialpilot/contracts";
import { prisma } from "../../config/prisma.js";
import { logger } from "../../config/logger.js";
import { env } from "../../config/env.js";
import { safeEqual } from "../../utils/crypto.js";
import { normalizeWebhookBody } from "../../engine/normalizer.js";
import { enqueueWebhookEvent } from "../../jobs/queue.js";
import * as instagramRepo from "../instagram/instagram.repository.js";
import type { WebhookBody } from "../instagram/instagram.types.js";

/**
 * Webhook ingestion.
 *
 * The contract with Meta is: respond 200 fast, or the delivery counts as
 * failed and the subscription is eventually disabled. So this path does the
 * minimum — verify, normalize, persist, enqueue — and nothing that can block.
 * Workflow execution happens on a worker.
 */

/**
 * The verification handshake Meta performs when the webhook URL is first saved.
 *
 * The token is compared in constant time. `===` would leak its length and
 * prefix through timing, and this endpoint is public and unauthenticated by
 * design, so it is directly probeable.
 */
export function verifySubscription(query: {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}): { challenge: string } | null {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];

  if (mode !== "subscribe" || !token || !challenge) return null;
  if (!env.META_WEBHOOK_VERIFY_TOKEN) {
    logger.error("webhook verification attempted but META_WEBHOOK_VERIFY_TOKEN is not configured");
    return null;
  }
  if (!safeEqual(token, env.META_WEBHOOK_VERIFY_TOKEN)) {
    logger.warn("webhook verification presented a wrong token");
    return null;
  }

  return { challenge };
}

/**
 * Verifies `X-Hub-Signature-256`.
 *
 * Computed over the *raw* received bytes. Re-serialising the parsed object
 * would change key order and unicode escaping and the signature would never
 * match — which is why app.ts captures `rawBody` for this route specifically.
 *
 * Returns false when the app secret is unset, so an unconfigured deployment
 * rejects everything rather than accepting anything.
 */
export function verifySignature(rawBody: Buffer | undefined, header: string | undefined): boolean {
  if (!env.META_APP_SECRET) {
    // In development with the mock provider there is no secret and no real
    // Meta; the route handler decides whether to require this.
    return false;
  }
  if (!rawBody || !header?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", env.META_APP_SECRET).update(rawBody).digest("hex");
  return safeEqual(header.slice("sha256=".length), expected);
}

export interface IngestResult {
  received: number;
  stored: number;
  duplicates: number;
  unroutable: number;
}

/**
 * Persists every event in a payload and hands each to the queue.
 *
 * Idempotency is the unique constraint on `eventId`, not a preceding read. A
 * read-then-write races: Meta's redeliveries arrive in bursts and two workers
 * can both see "not present" before either inserts. Letting the insert conflict
 * is the only check that actually holds.
 */
export async function ingest(body: WebhookBody): Promise<IngestResult> {
  const events = normalizeWebhookBody(body);
  const result: IngestResult = {
    received: events.length,
    stored: 0,
    duplicates: 0,
    unroutable: 0,
  };

  for (const event of events) {
    const routed = await route(event);
    if (!routed) result.unroutable += 1;

    try {
      const stored = await prisma.webhookEvent.create({
        data: {
          eventId: event.eventId,
          workspaceId: routed?.workspaceId ?? null,
          instagramAccountId: routed?.accountId ?? null,
          eventType: event.eventType,
          payload: body as unknown as Prisma.InputJsonValue,
          normalized: event as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      result.stored += 1;

      // Only routable, actionable events are worth a worker's time. An event
      // with no workspace has nothing to run against, and UNKNOWN has no
      // trigger — both are stored for diagnostics and left unprocessed.
      if (routed && event.eventType !== "UNKNOWN") {
        await enqueueWebhookEvent({ webhookEventId: stored.id });
      } else {
        await prisma.webhookEvent.update({
          where: { id: stored.id },
          data: { processed: true, processedAt: new Date() },
        });
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Exactly what the constraint is for. A redelivery, not a failure.
        result.duplicates += 1;
        logger.debug({ eventId: event.eventId }, "duplicate webhook event ignored");
        continue;
      }
      throw error;
    }
  }

  return result;
}

/**
 * Instagram account id → workspace. The account id is globally unique, so an
 * event has exactly one owner. A miss means the account is not connected here.
 */
async function route(
  event: NormalizedEvent
): Promise<{ workspaceId: string; accountId: string } | null> {
  const account = await instagramRepo.findAccountByInstagramUserId(event.recipientAccountId);
  if (!account) {
    logger.warn(
      { recipientAccountId: event.recipientAccountId },
      "webhook event for an unknown Instagram account"
    );
    return null;
  }
  return { workspaceId: account.workspaceId, accountId: account.id };
}
