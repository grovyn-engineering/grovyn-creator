import { z } from "zod";
import { idSchema, isoDateSchema } from "./api.js";

/**
 * Password policy. Length is the only rule enforced, on purpose: composition
 * rules (one uppercase, one symbol) measurably push users toward predictable
 * substitutions without adding entropy, and NIST SP 800-63B has recommended
 * against them since 2017. The 8-character floor is that guidance's minimum;
 * the 200-character ceiling exists so a pathological input cannot turn an
 * Argon2 hash into a denial-of-service vector.
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
  /**
   * Optional. When present, signup provisions this workspace instead of the
   * default "<Name>'s workspace", so onboarding is one form rather than two.
   */
  workspaceName: z.string().trim().min(1).max(60).optional(),
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  /**
   * Not `passwordSchema`: a login must accept any string, including one that
   * would fail today's policy. Applying the signup rules here would tell an
   * attacker which passwords are policy-shaped before any hash is compared,
   * and would lock out users who registered under an earlier policy.
   */
  password: z.string().min(1, "Enter your password.").max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** The authenticated user as the client sees them. No hash, ever. */
export const sessionUserSchema = z.object({
  id: idSchema,
  email: z.string(),
  name: z.string(),
  createdAt: isoDateSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const updateProfileRequestSchema = z.object({
  name: nameSchema,
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
