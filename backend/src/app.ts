import express, { type Express, type Request } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { env, isProduction } from "./config/env.js";
import { requestContext, httpLogger } from "./middleware/request-context.js";
import { attachSession } from "./middleware/authenticate.js";
import { apiLimiter } from "./middleware/rate-limit.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { apiRouter } from "./routes/index.js";

/**
 * Request bodies are capped well below anything legitimate. A workflow with
 * five actions is a couple of kilobytes; Meta's webhook batches are small.
 * The cap is the cheapest defence against a memory-exhaustion attempt, and it
 * applies before any parsing work happens.
 */
const BODY_LIMIT = "128kb";

declare module "express-serve-static-core" {
  interface Request {
    /**
     * The exact bytes received, captured only for the webhook route. Meta's
     * signature covers the raw payload, so verifying against a re-serialised
     * object would fail on any key-order or unicode-escape difference.
     */
    rawBody?: Buffer;
  }
}

export function createApp(): Express {
  const app = express();

  // Behind a load balancer, `req.ip` is the proxy unless the hop count is
  // configured. Rate limiting and audit logging both depend on it being the
  // real client. Set explicitly rather than `true`, which trusts any
  // X-Forwarded-For a client cares to send.
  app.set("trust proxy", env.TRUST_PROXY);
  app.disable("x-powered-by");

  app.use(requestContext);
  app.use(httpLogger);

  app.use(
    helmet({
      // The API serves JSON, never HTML, so a restrictive CSP here costs
      // nothing and stops a browser rendering any response that slipped
      // through as a document.
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      // Set to same-origin so a JSON error page cannot be embedded elsewhere.
      crossOriginResourcePolicy: { policy: "same-site" },
      hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: "no-referrer" },
    })
  );

  app.use(
    cors({
      // An allowlist of exactly one origin. `credentials: true` with a
      // reflected origin would let any site drive the API with the user's
      // cookies, which is the whole reason CORS exists.
      origin: env.FRONTEND_URL,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-Workspace-Id", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 600,
    })
  );

  app.use(
    express.json({
      limit: BODY_LIMIT,
      verify: (req: Request, _res, buf) => {
        // Captured only where it is needed. Keeping every request's bytes
        // alive would double the memory cost of the parser for no benefit.
        if (req.originalUrl.startsWith("/api/webhooks/")) {
          req.rawBody = Buffer.from(buf);
        }
      },
    })
  );
  app.use(express.urlencoded({ extended: false, limit: BODY_LIMIT }));
  app.use(cookieParser());

  // Resolves the session for every request, including public ones, so `/me`
  // and error responses can tell signed-in from signed-out.
  app.use(attachSession);

  // Liveness, before the limiter: a probe must not be able to trip it.
  app.get("/health", (_req, res) => {
    res.json({ success: true, data: { status: "ok", uptime: process.uptime() } });
  });

  const handlePrivacy = (_req: express.Request, res: express.Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(`<!DOCTYPE html>
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
  };

  const handleDataDeletion = (_req: express.Request, res: express.Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(`<!DOCTYPE html>
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
  };

  app.get("/privacy", handlePrivacy);
  app.get("/api/privacy", handlePrivacy);
  app.get("/data-deletion", handleDataDeletion);
  app.get("/api/data-deletion", handleDataDeletion);

  app.use("/api", apiLimiter, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
