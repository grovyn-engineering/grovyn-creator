"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Instagram, Plus, Workflow } from "lucide-react";
import type { DashboardRange } from "@socialpilot/contracts";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, ExecutionStatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from "@/components/ui/states";
import { MetricTile } from "@/components/dashboard/metric-tile";
import { ExecutionChart } from "@/components/dashboard/execution-chart";
import { useActivity, useDashboard } from "@/features/dashboard/use-dashboard";
import { absoluteTime, cn, formatPercent, relativeTime } from "@/lib/utils";
import { errorMessage } from "@/lib/api-client";

const RANGES: Array<{ value: DashboardRange; label: string }> = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

export default function DashboardPage() {
  const [range, setRange] = React.useState<DashboardRange>("30d");
  const dashboard = useDashboard(range);
  const activity = useActivity();

  if (dashboard.isError) {
    return (
      <>
        <PageHeader title="Overview" />
        <Card>
          <ErrorState
            message={errorMessage(dashboard.error)}
            onRetry={() => void dashboard.refetch()}
          />
        </Card>
      </>
    );
  }

  const data = dashboard.data;

  return (
    <>
      <PageHeader
        title="Overview"
        description="What your automation received and did, from your own execution records."
        actions={
          <div
            className="inline-flex rounded-md border border-border bg-surface p-0.5"
            role="group"
            aria-label="Time range"
          >
            {RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                aria-pressed={range === option.value}
                className={cn(
                  "rounded-[5px] px-2.5 py-1 text-[13px] font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-500",
                  range === option.value
                    ? "bg-ink-900 text-white"
                    : "text-ink-500 hover:text-ink-900"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      {dashboard.isLoading || !data ? (
        <DashboardSkeleton />
      ) : (
        <div className="space-y-5">
          <ConnectionBanner
            isConnected={data.summary.instagram.isConnected}
            needsReconnect={data.summary.instagram.needsReconnect}
            username={data.summary.instagram.username}
            hasWorkflows={data.summary.workflows.total > 0}
          />

          {/* KPI row. Executions is emphasised as the primary figure; the rest
              qualify it. Giving every tile equal weight would leave the reader
              to work out which number matters. */}
          <Card className="overflow-hidden">
            <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 [&>*]:border-border sm:[&>*:nth-child(n+2)]:border-l">
              <MetricTile
                label="Workflow runs"
                metric={data.summary.executions.total}
                emphasis
              />
              <MetricTile label="Succeeded" metric={data.summary.executions.succeeded} />
              <MetricTile
                label="Failed"
                metric={data.summary.executions.failed}
                invertDelta
              />
              <MetricTile
                label="Actions sent"
                metric={data.summary.actionsExecuted}
                hint="replies and messages delivered"
              />
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div>
                  <CardTitle>Execution history</CardTitle>
                  <p className="mt-0.5 text-[13px] text-ink-500">
                    {data.summary.executions.successRate === null
                      ? "No completed runs yet"
                      : `${formatPercent(data.summary.executions.successRate)} of attempted runs succeeded`}
                  </p>
                </div>
              </CardHeader>
              <ExecutionChart points={data.trend.points} />
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Events received</CardTitle>
              </CardHeader>
              <div className="divide-y divide-border">
                <MetricTile label="Comments" metric={data.summary.events.comments} hint="" />
                <MetricTile label="Messages" metric={data.summary.events.messages} hint="" />
              </div>
              {data.summary.events.pending > 0 && (
                <div className="border-t border-border px-5 py-3">
                  <Badge tone="warning" dot>
                    {data.summary.events.pending} waiting to process
                  </Badge>
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <WorkflowPerformancePanel workflows={data.workflows} />

            <Card>
              <CardHeader>
                <CardTitle>Recent activity</CardTitle>
                <Link
                  href="/activity"
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-600 hover:text-ink-900"
                >
                  All activity
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Link>
              </CardHeader>

              {activity.isLoading ? (
                <LoadingRegion label="Loading recent activity" className="space-y-3 px-5 py-4">
                  {[0, 1, 2, 3].map((index) => (
                    <Skeleton key={index} className="h-9" />
                  ))}
                </LoadingRegion>
              ) : (activity.data?.activity.length ?? 0) === 0 ? (
                <EmptyState
                  title="Nothing has run yet"
                  description="Once a workflow is enabled and someone comments on your posts, every run shows up here."
                  className="py-10"
                />
              ) : (
                <ul className="divide-y divide-border">
                  {activity.data?.activity.map((item) => (
                    <li key={item.id} className="flex items-start gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-ink-800">{item.summary}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-400">
                          <span className="truncate">{item.workflowName}</span>
                          <span aria-hidden="true">·</span>
                          <time dateTime={item.occurredAt} title={absoluteTime(item.occurredAt)}>
                            {relativeTime(item.occurredAt)}
                          </time>
                        </p>
                      </div>
                      <ExecutionStatusBadge status={item.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The dashboard's degraded state.
 *
 * Connection health is the one thing that makes every other number on this page
 * meaningless if it is wrong — an account that is disconnected will never
 * receive an event, so zero runs is expected rather than a mystery. Saying so
 * at the top is what turns a confusing empty dashboard into an actionable one.
 */
function ConnectionBanner({
  isConnected,
  needsReconnect,
  username,
  hasWorkflows,
}: {
  isConnected: boolean;
  needsReconnect: boolean;
  username: string | null;
  hasWorkflows: boolean;
}) {
  if (isConnected && hasWorkflows) return null;

  if (needsReconnect) {
    return (
      <Card className="border-warning-200 bg-warning-50">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-warning-700">
              Instagram connection needs attention
            </p>
            <p className="mt-0.5 text-[13px] text-warning-700/90">
              {username ? `@${username} ` : "The connected account "}
              can no longer be used. Reconnect it to resume automation.
            </p>
          </div>
          <Button size="sm" asChild>
            <Link href="/instagram">Reconnect</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!isConnected) {
    return (
      <Card>
        <EmptyState
          icon={Instagram}
          title="Connect Instagram to get started"
          description="Nothing can run until an Instagram account is connected — that connection is what delivers comments and messages to your workflows."
          action={
            <Button asChild>
              <Link href="/instagram">Connect Instagram</Link>
            </Button>
          }
          className="py-10"
        />
      </Card>
    );
  }

  return (
    <Card>
      <EmptyState
        icon={Workflow}
        title="Create your first workflow"
        description="Instagram is connected. Add a workflow to decide what should happen when someone comments or sends a message."
        action={
          <Button asChild>
            <Link href="/workflows/new">
              <Plus aria-hidden="true" />
              New workflow
            </Link>
          </Button>
        }
        className="py-10"
      />
    </Card>
  );
}

function WorkflowPerformancePanel({
  workflows,
}: {
  workflows: Array<{
    workflowId: string;
    name: string;
    executions: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
  }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workflow performance</CardTitle>
        <Link
          href="/workflows"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-600 hover:text-ink-900"
        >
          All workflows
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </CardHeader>

      {workflows.length === 0 ? (
        <EmptyState
          title="No runs in this period"
          description="Workflow performance appears here once your automation starts receiving events."
          className="py-10"
        />
      ) : (
        <ul className="divide-y divide-border">
          {workflows.map((workflow) => (
            <li key={workflow.workflowId} className="px-5 py-3">
              <div className="flex items-center justify-between gap-4">
                <Link
                  href={`/workflows/${workflow.workflowId}`}
                  className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-800 hover:text-ink-950 hover:underline underline-offset-2"
                >
                  {workflow.name}
                </Link>
                <span className="tabular shrink-0 text-[13px] text-ink-500">
                  {workflow.executions} {workflow.executions === 1 ? "run" : "runs"}
                </span>
              </div>

              {/* A proportional bar rather than a second number: at a glance,
                  a workflow that is mostly failing is obvious. */}
              <div className="mt-2 flex h-1.5 gap-px overflow-hidden rounded-full bg-ink-100">
                {workflow.succeeded > 0 && (
                  <div
                    className="bg-accent-500"
                    style={{ width: `${(workflow.succeeded / workflow.executions) * 100}%` }}
                  />
                )}
                {workflow.failed > 0 && (
                  <div
                    className="bg-danger-600"
                    style={{ width: `${(workflow.failed / workflow.executions) * 100}%` }}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <LoadingRegion label="Loading dashboard" className="space-y-5">
      <Card className="overflow-hidden">
        <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="space-y-2 px-5 py-4">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="px-5 py-4">
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="px-5 pb-6">
            <Skeleton className="h-[9.5rem]" />
          </div>
        </Card>
        <Card>
          <div className="px-5 py-4">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="space-y-4 px-5 pb-6">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        </Card>
      </div>
    </LoadingRegion>
  );
}
