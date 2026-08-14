import { Router } from "express";
import { env } from "../../config/env.js";
import { requireAuth } from "../../middleware/authenticate.js";
import { requireWorkspace, withWorkspace } from "../../middleware/workspace.js";
import * as controller from "./instagram.controller.js";

export const instagramRouter: Router = Router();

/**
 * The callback is mounted before the auth guard and stays public.
 *
 * The browser arrives here from instagram.com, and whether the session cookie
 * rides along depends on the SameSite policy and the redirect chain. Requiring
 * a session would break the flow intermittently and in a way that is very hard
 * to reproduce. Trust comes from `state`, which was minted against a real
 * session and can only be consumed once.
 */
instagramRouter.get("/callback", controller.callback);

// Only exists when the mock provider is active; the handler double-checks.
if (env.USE_MOCK_INSTAGRAM && env.NODE_ENV !== "production") {
  instagramRouter.get("/mock/authorize", controller.mockAuthorize);
}

instagramRouter.use(requireAuth, requireWorkspace);

instagramRouter.get("/", withWorkspace(controller.getConnection));
instagramRouter.get("/connect", withWorkspace(controller.beginConnect));
instagramRouter.get("/media", withWorkspace(controller.listMedia));
instagramRouter.delete("/:id", withWorkspace(controller.disconnect));
