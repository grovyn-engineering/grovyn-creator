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

// Public — Meta cannot present a session. Authenticity is the verify token on
// GET and the HMAC signature on POST.
apiRouter.use("/webhooks", webhooksRouter);
