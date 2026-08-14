"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import type { Paginated, WebhookEventSummary } from "@socialpilot/contracts";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from "@/components/ui/states";
import { api, errorMessage } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { useWorkspaceId } from "@/features/workspace/workspace-provider";
import { absoluteTime, cn, relativeTime } from "@/lib/utils";

/**
 * The Instagram activity log.
 *
 * This page exists to answer one specific question: "my workflow didn't fire —
 * did the event even reach you?" Without it, that question is unanswerable
 * without database access, and it is the single most common thing a user of an
 * automation product needs to know.
 *
 * The `executionCount` column is what carries the diagnosis. Zero runs against
 * a received comment means the event arrived and no workflow matched it, which
 * points at the conditions rather than at the connection.
 */
export default function ActivityPage() {
  const workspaceId = useWorkspaceId();
  const [filter, setFilter] = React.useState<"ALL" | "COMMENT" | "MESSAGE">("ALL");

  const events = useQuery({
    queryKey: queryKeys.events(workspaceId ?? "none", { filter }),
    queryFn: () =>
      api.get<Paginated<WebhookEventSummary>>("/api/events", {
        workspaceId,
        query: { limit: 50, eventType: filter === "ALL" ? undefined : filter },
      }),
    enabled: Boolean(workspaceId),
    // This is the page a user watches right after enabling a workflow.
    refetchInterval: 20_000,
  });

  const items = events.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Activity"
        description="Everything Instagram has sent to this workspace, and whether any workflow acted on it."
        actions={
          <div className="inline-flex rounded-md border border-border bg-surface p-0.5" role="group" aria-label="Filter events">
            {(["ALL", "COMMENT", "MESSAGE"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                aria-pressed={filter === option}
                className={cn(
                  "rounded-[5px] px-2.5 py-1 text-[13px] font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-500",
                  filter === option ? "bg-ink-900 text-white" : "text-ink-500 hover:text-ink-900"
                )}
              >
                {option === "ALL" ? "All" : option === "COMMENT" ? "Comments" : "Messages"}
              </button>
            ))}
          </div>
        }
      />

      {events.isError ? (
        <Card>
          <ErrorState message={errorMessage(events.error)} onRetry={() => void events.refetch()} />
        </Card>
      ) : events.isLoading ? (
        <LoadingRegion label="Loading activity">
          <Card className="divide-y divide-border">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="px-5 py-4">
                <Skeleton className="h-4 w-64" />
              </div>
            ))}
          </Card>
        </LoadingRegion>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Inbox}
            title="Nothing has arrived yet"
            description="When someone comments on a post or sends a message, it appears here within seconds — whether or not a workflow acts on it."
            secondaryAction={
              <Link
                href="/instagram"
                className="text-[13px] font-medium text-ink-600 underline underline-offset-4 hover:text-ink-900"
              >
                Check the Instagram connection
              </Link>
            }
          />
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {items.map((event) => (
            <div key={event.id} className="flex items-start gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-ink-800">{event.summary}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-400">
                  <time dateTime={event.receivedAt} title={absoluteTime(event.receivedAt)}>
                    {relativeTime(event.receivedAt)}
                  </time>
                  <span aria-hidden="true">·</span>
                  <span className="lowercase">{event.eventType}</span>
                  {event.error && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-danger-600">{event.error}</span>
                    </>
                  )}
                </p>
              </div>

              <div className="shrink-0">
                {event.executionCount > 0 ? (
                  <Badge tone="accent">
                    {event.executionCount} {event.executionCount === 1 ? "run" : "runs"}
                  </Badge>
                ) : event.processed ? (
                  <Badge tone="neutral">No match</Badge>
                ) : (
                  <Badge tone="warning" dot>
                    Queued
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
