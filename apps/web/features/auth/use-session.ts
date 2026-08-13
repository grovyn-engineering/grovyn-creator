"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type {
  LoginRequest,
  SessionUser,
  SignupRequest,
} from "@socialpilot/contracts";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

interface SessionResponse {
  user: SessionUser | null;
}

interface AuthResponse {
  user: SessionUser;
  activeWorkspaceId: string;
}

/**
 * The session probe.
 *
 * `/auth/me` answers 200 with `user: null` when signed out rather than 401,
 * so being logged out is an ordinary state rather than an error — which keeps
 * the login page from logging a failure on every visit and keeps this hook's
 * `error` meaning "something is actually wrong".
 */
export function useSession() {
  const query = useQuery({
    queryKey: queryKeys.session,
    queryFn: () => api.get<SessionResponse>("/api/auth/me"),
    // Longer than the default: a session does not change under the user, and
    // this runs on every page.
    staleTime: 5 * 60_000,
    retry: false,
  });

  return {
    user: query.data?.user ?? null,
    isAuthenticated: Boolean(query.data?.user),
    isLoading: query.isLoading,
    error: query.error,
  };
}

export function useLogin() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (input: LoginRequest) => api.post<AuthResponse>("/api/auth/login", input),
    onSuccess: (data) => {
      // Seeded rather than invalidated, so the first authenticated render has
      // the user already and does not flash a loading state.
      queryClient.setQueryData(queryKeys.session, { user: data.user });
      // Anything cached from a previous session in this tab belongs to a
      // different user and must not survive the boundary.
      queryClient.removeQueries({ queryKey: queryKeys.workspaces });
      router.push("/dashboard");
      router.refresh();
    },
  });
}

export function useSignup() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (input: SignupRequest) => api.post<AuthResponse>("/api/auth/signup", input),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.session, { user: data.user });
      // Signup provisions a workspace transactionally, so the new user always
      // lands on a working dashboard rather than an onboarding dead end.
      router.push("/dashboard");
      router.refresh();
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: () => api.post<void>("/api/auth/logout"),
    // `onSettled`, not `onSuccess`: if the logout request fails the user still
    // asked to leave, and stranding them in a signed-in shell with a dead
    // session is worse than clearing optimistically. The cookie is cleared by
    // the server on any outcome it can reach.
    onSettled: () => {
      queryClient.clear();
      router.push("/login");
      router.refresh();
    },
  });
}
