import type { Request, Response } from "express";
import { env, isProduction } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import * as service from "./webhooks.service.js";
import type { WebhookBody } from "../instagram/instagram.types.js";

/**
 * Meta's verification GET. Responds with the raw challenge as plain text —
 * not the JSON envelope, because Meta compares the body byte for byte.
 */
export function verify(req: Request, res: Response): void {
  const result = service.verifySubscription(req.query);

  if (!result) {
    // 403, not 401: there is no credential to supply. Meta shows this verbatim
    // in the App Dashboard when a verify token does not match.
    res.status(403).type("text/plain").send("Forbidden");
    return;
  }

  res.status(200).type("text/plain").send(result.challenge);
}

/**
 * Event delivery.
 *
 * Answers 200 before doing anything that could be slow. Meta's timeout is a
 * few seconds and a slow response is recorded as a failed delivery; enough of
 * them and the subscription is disabled outright, which is a silent, total
 * outage of the product's core function.
 *
 * So: verify the signature, acknowledge, then ingest. Ingestion still persists
 * every event and enqueues it, and a crash between the two loses at most the
 * events in that one payload — which Meta will redeliver, and which the
 * `eventId` constraint will deduplicate.
 */
export async function receive(req: Request, res: Response): Promise<void> {
  const signature = req.get("x-hub-signature-256");
  const valid = service.verifySignature(req.rawBody, signature);

  if (!valid) {
    // The mock provider has no app secret to sign with, so signature checking
    // is relaxed in development only. In production an unsigned or wrongly
    // signed payload is rejected without being read.
    if (isProduction || !env.USE_MOCK_INSTAGRAM) {
      logger.warn({ hasSignature: Boolean(signature) }, "rejected unsigned webhook delivery");
      res.status(403).type("text/plain").send("Invalid signature");
      return;
    }
    logger.warn("accepting an unsigned webhook — development mode with the mock provider");
  }

  res.status(200).type("text/plain").send("EVENT_RECEIVED");

  const body = req.body as WebhookBody;
  if (body?.object !== "instagram") {
    logger.debug({ object: body?.object }, "ignoring webhook for a non-Instagram object");
    return;
  }

  try {
    const result = await service.ingest(body);
    logger.info(result, "webhook payload ingested");
  } catch (error) {
    // The response has already been sent, so this cannot become an HTTP error.
    // Logging is the only recourse — and Meta will redeliver.
    logger.error({ err: error }, "webhook ingestion failed after acknowledgement");
  }
}
