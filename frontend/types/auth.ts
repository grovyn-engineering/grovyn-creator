import { z } from "zod";

/**
 * Auth shapes and form schemas. Mirrors `backend/src/contracts/auth.ts`.
 *
 * These schemas exist for inline form feedback. The backend re-validates every
 * one of them and returns field-level errors, so a drift here is a UX bug, not
 * a security hole.
 */

export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(200, "Password is too long.");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email("Enter a valid email address.");

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name.")
  .max(80, "Name is too long.");

export const signupRequestSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  workspaceName: z.string().trim().min(1).max(60).optional(),
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema` — a login must accept any string, including one that
  // would fail today's policy, or users who registered under an earlier policy
  // are locked out.
  password: z.string().min(1, "Enter your password.").max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const updateProfileRequestSchema = z.object({ name: nameSchema });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** The authenticated user as the client sees them. No hash, ever. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}
