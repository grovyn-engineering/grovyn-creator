import type { Request, Response } from "express";
import { env, isProduction } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import * as service from "./webhooks.service.js";
import type { WebhookBody } from "../instagram/instagram.types.js";
import { appendWebhookDebugLog } from "../../utils/file-logger.js";

/**
 * Meta's verification GET. Responds with the raw challenge as plain text —
 * not the JSON envelope, because Meta compares the body byte for byte.
 */
export function verify(req: Request, res: Response): void {
  const result = service.verifySubscription(req.query);

  appendWebhookDebugLog(
    `GET /api/webhooks/instagram Verification Request\nQuery: ${JSON.stringify(req.query, null, 2)}\nVerification Result: ${result ? "SUCCESS (Challenge Sent)" : "FAILED (403 Forbidden)"}`
  );

  if (!result) {
    // 403, not 401: there is no credential to supply. Meta shows this verbatim
    // in the App Dashboard when a verify token does not match.
    res.status(403).type("text/plain").send("Forbidden");
    return;
  }

  res.status(200).type("text/plain").send(result.challenge);
}

export function privacy(_req: Request, res: Response): void {
  res.status(200).type("text/html").send(`<!DOCTYPE html>
<html>
<head><title>SocialPilot Privacy Policy</title></head>
<body style="font-family: sans-serif; padding: 40px; line-height: 1.6; max-width: 800px; margin: 0 auto;">
  <h1>SocialPilot Privacy Policy</h1>
  <p>SocialPilot respects your privacy and is committed to protecting your personal data.</p>
  <p>We only use your Instagram permissions to automate direct messages and manage comments as configured in your workflows.</p>
  <p>We do not sell, rent, or share your personal data with any third parties.</p>
  <p>For questions or support, contact support@socialpilot.app</p>
</body>
</html>`);
}

export function dataDeletion(_req: Request, res: Response): void {
  res.status(200).type("text/html").send(`<!DOCTYPE html>
<html>
<head><title>SocialPilot Data Deletion Instructions</title></head>
<body style="font-family: sans-serif; padding: 40px; line-height: 1.6; max-width: 800px; margin: 0 auto;">
  <h1>SocialPilot User Data Deletion Instructions</h1>
  <p>To request deletion of your account and data from SocialPilot:</p>
  <ol>
    <li>Log into SocialPilot Dashboard and disconnect your Instagram account under Accounts page.</li>
    <li>Remove the SocialPilot application under Instagram Apps & Websites settings.</li>
    <li>You can also request full data erasure by contacting support@socialpilot.app</li>
  </ol>
</body>
</html>`);
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

  const rawBodyText = req.rawBody ? req.rawBody.toString("utf8") : "NO_RAW_BODY";

  if (!valid) {
    appendWebhookDebugLog(
      `POST /api/webhooks/instagram Event Delivery [INVALID SIGNATURE]\nSignature Header: ${signature ?? "NONE"}\nRaw Body: ${rawBodyText}`
    );
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

  appendWebhookDebugLog(
    `POST /api/webhooks/instagram Event Delivery [200 ACKNOWLEDGED]\nSignature Valid: ${valid}\nObject: ${body?.object ?? "NONE"}\nPayload JSON:\n${JSON.stringify(body, null, 2)}`
  );

  if (body?.object !== "instagram") {
    logger.debug({ object: body?.object }, "ignoring webhook for a non-Instagram object");
    return;
  }

  try {
    const result = await service.ingest(body);
    appendWebhookDebugLog(
      `Webhook Ingest Outcome:\nReceived: ${result.received}\nStored: ${result.stored}\nDuplicates: ${result.duplicates}\nUnroutable: ${result.unroutable}`
    );
    logger.info(result, "webhook payload ingested");
  } catch (error) {
    appendWebhookDebugLog(`Webhook Ingest ERROR:\n${String(error)}`);
    // The response has already been sent, so this cannot become an HTTP error.
    // Logging is the only recourse — and Meta will redeliver.
    logger.error({ err: error }, "webhook ingestion failed after acknowledgement");
  }
}

