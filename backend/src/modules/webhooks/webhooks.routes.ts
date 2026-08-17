import { Router } from "express";
import * as controller from "./webhooks.controller.js";

/**
 * Public and deliberately unauthenticated — Meta cannot present a session.
 * Authenticity comes from the verify token on GET and the HMAC signature on
 * POST, both checked in the service.
 *
 * Note that no rate limiter is mounted here. Meta bursts hard after any outage,
 * and a 429 is recorded as a failed delivery that counts toward disabling the
 * subscription. The handler is bounded and fast instead.
 */
export const webhooksRouter: Router = Router();

webhooksRouter.get("/instagram", controller.verify);
webhooksRouter.post("/instagram", controller.receive);
webhooksRouter.get("/privacy", controller.privacy);
webhooksRouter.get("/data-deletion", controller.dataDeletion);


