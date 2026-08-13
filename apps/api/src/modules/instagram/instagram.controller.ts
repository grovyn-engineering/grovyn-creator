import type { Request, Response } from "express";
import { instagramCallbackQuerySchema } from "@socialpilot/contracts";
import { env } from "../../config/env.js";
import { noContent, ok } from "../../http/respond.js";
import { AppError } from "../../http/errors.js";
import { pathParam } from "../../http/params.js";
import type { WorkspaceRequest } from "../../middleware/workspace.js";
import { getProvider, MockInstagramProvider } from "./instagram.provider.js";
import * as oauth from "./instagram.oauth.service.js";
import * as service from "./instagram.service.js";

export async function getConnection(req: WorkspaceRequest, res: Response): Promise<void> {
  const connection = await service.getConnection(req.workspace.id);
  ok(res, connection);
}

export async function beginConnect(req: WorkspaceRequest, res: Response): Promise<void> {
  const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : null;

  const result = await oauth.beginConnect({
    workspaceId: req.workspace.id,
    userId: req.auth.userId,
    returnTo,
  });

  // Returns the URL rather than issuing a 302. An XHR cannot follow a redirect
  // to a third-party consent screen, so the frontend has to navigate the top
  // window itself.
  ok(res, result);
}

/**
 * Meta's redirect target.
 *
 * Unauthenticated by necessity — the browser arrives here from instagram.com
 * and the session cookie may or may not ride along. Trust comes entirely from
 * the `state` parameter, which was minted server-side against a real session.
 *
 * Always answers with a 302 to the frontend, never JSON: a person is looking at
 * this response in their address bar.
 */
export async function callback(req: Request, res: Response): Promise<void> {
  const parsed = instagramCallbackQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.redirect(`${env.FRONTEND_URL}/instagram?status=error&reason=invalid_request`);
    return;
  }

  const result = await oauth.handleCallback(parsed.data);
  res.redirect(result.redirectTo);
}

export async function disconnect(req: WorkspaceRequest, res: Response): Promise<void> {
  await oauth.disconnect({
    accountId: pathParam(req, "id"),
    workspaceId: req.workspace.id,
    userId: req.auth.userId,
  });

  noContent(res);
}

export async function listMedia(req: WorkspaceRequest, res: Response): Promise<void> {
  const media = await service.listMedia(req.workspace.id);
  ok(res, { media });
}

/**
 * Development-only stand-in for Instagram's consent screen.
 *
 * It exists so the real callback path — state verification, code exchange,
 * encryption, upsert, audit — is exercised end to end without Meta
 * credentials. The route is only mounted when the mock provider is active, and
 * `getProvider` refuses to construct that in production.
 */
export async function mockAuthorize(req: Request, res: Response): Promise<void> {
  const provider = getProvider();
  if (!(provider instanceof MockInstagramProvider)) {
    throw AppError.notFound("That endpoint");
  }

  const state = typeof req.query.state === "string" ? req.query.state : "";
  const username =
    typeof req.query.username === "string" && req.query.username.trim()
      ? req.query.username.trim().replace(/[^a-zA-Z0-9._]/g, "")
      : "";

  if (!username) {
    res.type("html").send(consentScreen(state));
    return;
  }

  const code = provider.issueCode(username);
  const target = new URL("/api/instagram/callback", env.BACKEND_URL);
  target.searchParams.set("code", code);
  target.searchParams.set("state", state);
  res.redirect(target.toString());
}

/** Plain, unstyled, and obviously not Instagram — nobody should mistake this for the real thing. */
function consentScreen(state: string): string {
  const safeState = state.replace(/[^A-Za-z0-9_-]/g, "");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Mock Instagram authorization</title>
<style>
 body{font:15px/1.6 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.5rem;color:#18181b}
 .note{background:#fef3c7;border:1px solid #fcd34d;padding:.75rem 1rem;border-radius:.5rem;margin-bottom:1.5rem}
 label{display:block;font-weight:600;margin-bottom:.35rem}
 input{width:100%;padding:.6rem .7rem;border:1px solid #d4d4d8;border-radius:.5rem;font-size:1rem}
 button{margin-top:1rem;padding:.6rem 1.1rem;border:0;border-radius:.5rem;background:#18181b;color:#fff;font-size:1rem;cursor:pointer}
</style></head>
<body>
 <div class="note"><strong>Development mock.</strong> This is not Instagram. No real account is involved and no data leaves this machine.</div>
 <h1>Authorize SocialPilot</h1>
 <p>Choose a username for the simulated account you want to connect.</p>
 <form method="GET" action="/api/instagram/mock/authorize">
   <input type="hidden" name="state" value="${safeState}">
   <label for="username">Instagram username</label>
   <input id="username" name="username" value="demo_studio" autofocus pattern="[a-zA-Z0-9._]+" required>
   <button type="submit">Authorize</button>
 </form>
</body></html>`;
}
