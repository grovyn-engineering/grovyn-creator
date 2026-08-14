import { Router } from "express";
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  signupRequestSchema,
  updateProfileRequestSchema,
} from "../../contracts/index.js";
import { validateBody } from "../../http/validate.js";
import { requireAuth } from "../../middleware/authenticate.js";
import { authLimiter } from "../../middleware/rate-limit.js";
import * as controller from "./auth.controller.js";

export const authRouter: Router = Router();

authRouter.post("/signup", authLimiter, validateBody(signupRequestSchema), controller.signup);
authRouter.post("/login", authLimiter, validateBody(loginRequestSchema), controller.login);

// Not rate limited, and not requiring auth: ending a session must always work.
authRouter.post("/logout", controller.logout);

// The frontend's session probe, called on every page load.
authRouter.get("/me", controller.me);

authRouter.patch(
  "/profile",
  requireAuth,
  validateBody(updateProfileRequestSchema),
  controller.updateProfile
);

authRouter.post(
  "/password",
  requireAuth,
  authLimiter,
  validateBody(changePasswordRequestSchema),
  controller.changePassword
);
