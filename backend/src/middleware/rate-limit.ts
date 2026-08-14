import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request, Response } from "express";
import { isTest } from "../config/env.js";
import { fail } from "../http/respond.js";

/**
 * Rate limiting.
 *
 * Two tiers, because the threats differ. Authentication endpoints are the
 * target of credential stuffing and are limited tightly by IP. Everything else
 * is limited per session, generously — the goal there is to blunt a runaway
 * client or a scraper, not to interfere with normal use.
 *
 * The store is in-memory, which means the limit is per process. That is honest
 * for a single-instance deployment and stated in deployment.md: running several
 * replicas requires the Redis store, and the limits below are then per replica.
 */

function handler(_req: Request, res: Response): void {
  fail(res, 429, {
    code: "RATE_LIMITED",
    message: "Too many requests. Wait a moment and try again.",
  });
}

const shared: Partial<Options> = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler,
  // Tests exercise these routes in tight loops; leaving the limiter on would
  // make the suite fail on iteration count rather than on behaviour.
  skip: () => isTest,
};

/**
 * Keyed by IP, since an attacker trying many passwords has no session yet.
 * `ipKeyGenerator` is used rather than `req.ip` directly because it normalises
 * IPv6 to a /64 prefix — without it, an attacker with a routed v6 block gets a
 * fresh bucket for every request.
 */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60_000,
  limit: 10,
  // Only failures count. A user legitimately signing in on several devices
  // should not be locked out by their own successes.
  skipSuccessfulRequests: true,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
});

/**
 * Keyed by session where there is one, falling back to IP. Session-keyed is
 * fairer behind NAT, where a whole office shares an address.
 */
export const apiLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 300,
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? ""),
});

/**
 * Deliberately absent from the webhook route.
 *
 * Meta bursts redeliveries after any outage, and a 429 there is treated as a
 * delivery failure that counts toward disabling the subscription outright. The
 * webhook is protected by signature verification and a fast, bounded handler
 * instead.
 */
export const noLimiter = undefined;
