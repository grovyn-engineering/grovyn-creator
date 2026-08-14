"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiClientError } from "@/lib/api";

/**
 * TanStack Query configuration.
 *
 * The client is created inside a `useState` initialiser rather than at module
 * scope. At module scope it would be shared across requests on the server,
 * which leaks one user's cached data into another's render — the single most
 * consequential mistake available in this file.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Dashboard figures move on webhook timescales, not sub-second
            // ones. Thirty seconds avoids a refetch storm on every navigation
            // while still feeling live.
            staleTime: 30_000,
            gcTime: 5 * 60_000,

            retry: (failureCount, error) => {
              // Retrying a 401 cannot succeed and delays the redirect to login;
              // retrying a 403 or a 404 is equally pointless. Only genuinely
              // transient failures are worth another attempt.
              if (error instanceof ApiClientError && !error.isRetryable) return false;
              return failureCount < 2;
            },

            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8_000),

            // Refetching on focus is right for a live operations dashboard —
            // a user returning to the tab expects current numbers.
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
          mutations: {
            // Mutations are never retried automatically. Several of these
            // endpoints have side effects on a real Instagram account, and a
            // silent retry after an ambiguous failure could post twice.
            retry: false,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
