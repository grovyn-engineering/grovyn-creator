"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Search, Workflow as WorkflowIcon } from "lucide-react";
import type { WorkflowStatus } from "@socialpilot/contracts";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WorkflowStatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from "@/components/ui/states";
import { useWorkflows } from "@/features/workflows/use-workflows";
import { errorMessage } from "@/lib/api-client";
import { absoluteTime, cn, relativeTime } from "@/lib/utils";

const FILTERS: Array<{ value: WorkflowStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAUSED", label: "Paused" },
  { value: "DRAFT", label: "Draft" },
];

const TRIGGER_LABELS: Record<string, string> = {
  COMMENT_RECEIVED: "On new comment",
  MESSAGE_RECEIVED: "On new message",
  MENTION_RECEIVED: "On mention",
};

export default function WorkflowsPage() {
  const [status, setStatus] = React.useState<WorkflowStatus | "ALL">("ALL");
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");

  // Debounced so typing does not fire a request per keystroke.
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const workflows = useWorkflows({
    ...(status !== "ALL" ? { status } : {}),
    ...(debounced ? { search: debounced } : {}),
  });

  const items = workflows.data?.workflows ?? [];
  const isFiltered = status !== "ALL" || debounced.length > 0;

  return (
    <>
      <PageHeader
        title="Workflows"
        description="Each workflow watches for one kind of event and decides what to do about it."
        actions={
          <Button asChild>
            <Link href="/workflows/new">
              <Plus aria-hidden="true" />
              New workflow
            </Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-md border border-border bg-surface p-0.5" role="group" aria-label="Filter by status">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatus(filter.value)}
              aria-pressed={status === filter.value}
              className={cn(
                "rounded-[5px] px-2.5 py-1 text-[13px] font-medium transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-500",
                status === filter.value ? "bg-ink-900 text-white" : "text-ink-500 hover:text-ink-900"
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="relative sm:w-64">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search workflows"
            aria-label="Search workflows"
            className="h-9 w-full rounded-md border border-border-strong bg-surface pl-8 pr-3 text-sm text-ink-900 placeholder:text-ink-400 hover:border-ink-400"
          />
        </div>
      </div>

      {workflows.isError ? (
        <Card>
          <ErrorState message={errorMessage(workflows.error)} onRetry={() => void workflows.refetch()} />
        </Card>
      ) : workflows.isLoading ? (
        <LoadingRegion label="Loading workflows">
          <Card className="divide-y divide-border">
            {[0, 1, 2].map((index) => (
              <div key={index} className="space-y-2 px-5 py-4">
                <Skeleton className="h-4 w-52" />
                <Skeleton className="h-3 w-72" />
              </div>
            ))}
          </Card>
        </LoadingRegion>
      ) : items.length === 0 ? (
        <Card>
          {isFiltered ? (
            <EmptyState
              icon={Search}
              title="No workflows match"
              description="Try a different search term, or clear the status filter to see everything."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStatus("ALL");
                    setSearch("");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={WorkflowIcon}
              title="No workflows yet"
              description="A workflow watches for something on Instagram — a comment, a message — and acts on it automatically. Create one to stop answering the same question by hand."
              action={
                <Button asChild>
                  <Link href="/workflows/new">
                    <Plus aria-hidden="true" />
                    Create your first workflow
                  </Link>
                </Button>
              }
            />
          )}
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {items.map((workflow) => (
            <Link
              key={workflow.id}
              href={`/workflows/${workflow.id}`}
              className={cn(
                "flex items-center gap-4 px-5 py-4 transition-colors",
                "hover:bg-ink-50/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-500",
                "first:rounded-t-xl last:rounded-b-xl"
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <span className="truncate text-sm font-medium text-ink-900">{workflow.name}</span>
                  <WorkflowStatusBadge status={workflow.status} />
                </div>

                <p className="mt-1 truncate text-[12.5px] text-ink-500">
                  {TRIGGER_LABELS[workflow.triggerType] ?? workflow.triggerType}
                  <span aria-hidden="true"> · </span>
                  {workflow.conditionCount === 0
                    ? "no conditions"
                    : `${workflow.conditionCount} condition${workflow.conditionCount === 1 ? "" : "s"}`}
                  <span aria-hidden="true"> · </span>
                  {workflow.actionCount} action{workflow.actionCount === 1 ? "" : "s"}
                </p>
              </div>

              <div className="hidden shrink-0 text-right sm:block">
                <p className="tabular text-[13px] text-ink-700">
                  {workflow.executionCount} {workflow.executionCount === 1 ? "run" : "runs"}
                </p>
                <p className="mt-0.5 text-[12px] text-ink-400">
                  {workflow.lastExecutedAt ? (
                    <time
                      dateTime={workflow.lastExecutedAt}
                      title={absoluteTime(workflow.lastExecutedAt)}
                    >
                      last {relativeTime(workflow.lastExecutedAt)}
                    </time>
                  ) : (
                    "never run"
                  )}
                </p>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}
