import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { authRouter } from "../modules/auth/auth.routes.js";
import { workspacesRouter } from "../modules/workspaces/workspaces.routes.js";
import { dashboardRouter } from "../modules/dashboard/dashboard.routes.js";
import { instagramRouter } from "../modules/instagram/instagram.routes.js";
import { workflowsRouter } from "../modules/workflows/workflows.routes.js";
import { webhooksRouter } from "../modules/webhooks/webhooks.routes.js";
import { eventsRouter } from "../modules/events/events.routes.js";

/**
 * The API surface, assembled in one place so the routing table is readable
 * without walking the module tree.
 */
export const apiRouter: Router = Router();

/**
 * Readiness, as opposed to the liveness probe in app.ts. This one touches the
 * database, because a process that is running but cannot reach Postgres should
 * be taken out of a load balancer rather than served traffic.
 */
apiRouter.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, service: "api", database: "connected" });
  } catch {
    // 503, so a load balancer takes the instance out rather than sending it
    // traffic it cannot serve. The body says the database is unreachable and
    // nothing more — not which host, which user, or what the driver said.
    res.status(503).json({ success: false, service: "api", database: "disconnected" });
  }
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/workspaces", workspacesRouter);
apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/instagram", instagramRouter);
apiRouter.use("/workflows", workflowsRouter);
apiRouter.use("/events", eventsRouter);

// Public — Privacy Policy and Data Deletion HTML pages for Meta App requirement
apiRouter.get("/privacy", (_req, res) => {
  res.type("text/html").send(`<!DOCTYPE html>
<html>
<head><title>SocialPilot Privacy Policy</title></head>
<body style="font-family: sans-serif; padding: 40px; line-height: 1.6; max-width: 800px; margin: 0 auto;">
  <h1>SocialPilot Privacy Policy</h1>
  <p>SocialPilot respects your privacy and is committed to protecting your personal data.</p>
  <p>We only use your Instagram permissions to automate direct messages and manage comments as configured in your workflows.</p>
  <p>We do not sell, rent, or share your personal data with any third parties.</p>
  <p>For questions or support, contact tech@grovyn.in</p>
</body>
</html>`);
});

apiRouter.get("/data-deletion", (_req, res) => {
  res.type("text/html").send(`<!DOCTYPE html>
<html>
<head><title>SocialPilot Data Deletion Instructions</title></head>
<body style="font-family: sans-serif; padding: 40px; line-height: 1.6; max-width: 800px; margin: 0 auto;">
  <h1>SocialPilot User Data Deletion Instructions</h1>
  <p>To request deletion of your account and data from SocialPilot:</p>
  <ol>
    <li>Log into SocialPilot Dashboard and disconnect your Instagram account under Accounts page.</li>
    <li>Remove the SocialPilot application under Instagram Apps & Websites settings.</li>
    <li>You can also request full data erasure by contacting tech@grovyn.in</li>
  </ol>
</body>
</html>`);
});

// Public — Meta cannot present a session. Authenticity is the verify token on
// GET and the HMAC signature on POST.
apiRouter.use("/webhooks", webhooksRouter);

