import type {
  ChangePasswordRequest,
  LoginRequest,
  SessionUser,
  SignupRequest,
  UpdateProfileRequest,
} from "@/types";
import { http } from "./client";

export interface AuthResult {
  user: SessionUser;
  activeWorkspaceId: string;
}

export const auth = {
  /**
   * The session probe. Answers 200 with `user: null` when signed out rather
   * than 401 — being logged out is an ordinary state, and a 401 would make
   * every client log a console error on the login page.
   */
  me: () => http.get<{ user: SessionUser | null }>("/api/auth/me"),

  signup: (input: SignupRequest) => http.post<AuthResult>("/api/auth/signup", input),

  login: (input: LoginRequest) => http.post<AuthResult>("/api/auth/login", input),

  logout: () => http.post<void>("/api/auth/logout"),

  updateProfile: (input: UpdateProfileRequest) =>
    http.patch<{ user: SessionUser }>("/api/auth/profile", input),

  /** Revokes every other session server-side. */
  changePassword: (input: ChangePasswordRequest) =>
    http.post<void>("/api/auth/password", input),
};
