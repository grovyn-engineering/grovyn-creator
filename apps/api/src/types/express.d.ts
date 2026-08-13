import type { WorkspaceRole } from "@socialpilot/contracts";

/**
 * Request augmentation for what the auth and workspace middleware attach.
 *
 * Both are optional at the type level even though `requireAuth` guarantees
 * `auth` is present downstream. Declaring them non-optional would make every
 * public route lie about its own request shape, and the narrowing helpers in
 * middleware/authenticate.ts recover the strong type where it is actually
 * warranted.
 */
declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        sessionId: string;
        email: string;
        name: string;
      };
      /**
       * The workspace this request operates on, resolved and access-checked by
       * `requireWorkspace`. Its presence is the proof that authorization ran.
       */
      workspace?: {
        id: string;
        name: string;
        slug: string;
        role: WorkspaceRole;
      };
    }

    interface Locals {
      requestId?: string;
    }
  }
}

export {};
