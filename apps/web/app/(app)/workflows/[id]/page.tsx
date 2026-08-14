"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FlaskConical, Trash2 } from "lucide-react";
import type { UpdateWorkflowRequest } from "@socialpilot/contracts";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WorkflowStatusBadge, ExecutionStatusBadge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field, FieldInput, FieldLabel } from "@/components/ui/field";
import { EmptyState, ErrorState, InlineError, LoadingRegion, Skeleton } from "@/components/ui/states";
import { WorkflowBuilder } from "@/components/workflows/workflow-builder";
import {
  useDeleteWorkflow,
  useSetWorkflowEnabled,
  useTestWorkflow,
  useUpdateWorkflow,
  useWorkflow,
  useWorkflowExecutions,
} from "@/features/workflows/use-workflows";
import { errorMessage } from "@/lib/api-client";
import { absoluteTime, relativeTime } from "@/lib/utils";

export default function WorkflowDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const workflow = useWorkflow(id);
  const executions = useWorkflowExecutions(id);
  const update = useUpdateWorkflow(id);
  const setEnabled = useSetWorkflowEnabled(id);
  const remove = useDeleteWorkflow();

  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  if (workflow.isError) {
    return (
      <Card>
        <ErrorState
          message={errorMessage(workflow.error)}
          onRetry={() => void workflow.refetch()}
          action={
            <Button variant="secondary" asChild>
              <Link href="/workflows">Back to workflows</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  if (workflow.isLoading || !workflow.data) {
    return (
      <LoadingRegion label="Loading workflow" className="space-y-5">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-56" />
      </LoadingRegion>
    );
  }

  const data = workflow.data.workflow;
  const isActive = data.status === "ACTIVE";

  return (
    <>
      <Link
        href="/workflows"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Workflows
      </Link>

      <PageHeader
        title={data.name}
        description={data.description ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <WorkflowStatusBadge status={data.status} />
            <Button variant="secondary" onClick={() => setTesting(true)}>
              <FlaskConical aria-hidden="true" />
              Test
            </Button>
            <Button
              variant={isActive ? "secondary" : "primary"}
              loading={setEnabled.isPending}
              onClick={() => setEnabled.mutate(!isActive)}
            >
              {isActive ? "Disable" : "Enable"}
            </Button>
          </div>
        }
      />

      {/*
        Enabling can legitimately be refused — the API requires a connected
        Instagram account, because a workflow marked ACTIVE with nothing feeding
        it would sit here looking live and never run.
      */}
      {setEnabled.isError && (
        <div className="mb-5">
          <InlineError message={errorMessage(setEnabled.error)} />
        </div>
      )}

      <div className="space-y-5">
        <WorkflowBuilder
          defaultValues={{
            name: data.name,
            description: data.description ?? "",
            triggerType: data.triggerType,
            conditions: data.conditions.map((condition) => ({
              field: condition.field,
              operator: condition.operator,
              value: condition.value,
            })),
            actions: data.actions.map((action) => ({
              actionType: action.actionType,
              configuration: action.configuration,
            })) as UpdateWorkflowRequest["actions"],
          }}
          submitLabel="Save changes"
          isSubmitting={update.isPending}
          onSubmit={async (values) => {
            try {
              await update.mutateAsync(values);
            } catch (error) {
              throw new Error(errorMessage(error));
            }
          }}
          secondaryActions={
            <Button variant="dangerSubtle" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          }
        />

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Run history</CardTitle>
              <p className="mt-0.5 text-[13px] text-ink-500">
                Every time this workflow was evaluated, including runs that matched nothing.
              </p>
            </div>
          </CardHeader>

          {executions.isLoading ? (
            <LoadingRegion label="Loading run history" className="space-y-3 px-5 py-4">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </LoadingRegion>
          ) : (executions.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              title="This workflow has not run yet"
              description={
                isActive
                  ? "It is enabled and waiting. The next matching event on Instagram will appear here."
                  : "Enable it, or use Test to try it against a sample event without sending anything."
              }
              className="py-10"
            />
          ) : (
            <ul className="divide-y divide-border">
              {executions.data?.items.map((execution) => (
                <li key={execution.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <ExecutionStatusBadge status={execution.status} />
                        {execution.mode === "DRY_RUN" && (
                          <span className="text-[11.5px] font-medium text-ink-400">test run</span>
                        )}
                        <time
                          dateTime={execution.startedAt}
                          title={absoluteTime(execution.startedAt)}
                          className="text-[12px] text-ink-400"
                        >
                          {relativeTime(execution.startedAt)}
                        </time>
                        {execution.durationMs !== null && (
                          <span className="tabular text-[12px] text-ink-400">
                            {execution.durationMs}ms
                          </span>
                        )}
                      </div>

                      {/*
                        The reason a run did nothing is the most useful thing on
                        this page — it turns "my workflow isn't working" into
                        "my condition doesn't match what people actually write".
                      */}
                      {(execution.skipReason || execution.error) && (
                        <p className="mt-1 text-[12.5px] leading-5 text-ink-500">
                          {execution.error ?? execution.skipReason}
                        </p>
                      )}

                      {execution.results.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5">
                          {execution.results.map((result) => (
                            <li
                              key={result.actionId}
                              className="flex items-center gap-2 text-[12px] text-ink-500"
                            >
                              <span
                                aria-hidden="true"
                                className={
                                  result.status === "SUCCESS"
                                    ? "size-1.5 rounded-full bg-success-600"
                                    : result.status === "FAILED"
                                      ? "size-1.5 rounded-full bg-danger-600"
                                      : "size-1.5 rounded-full bg-ink-300"
                                }
                              />
                              <span>{result.actionType.toLowerCase().replace(/_/g, " ")}</span>
                              {result.error && <span className="text-ink-400">— {result.error}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <TestDialog open={testing} onOpenChange={setTesting} workflowId={id} />

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this workflow?"
        description="Its run history stays available on the Activity page, but the workflow itself cannot be recovered."
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(id)}>
            Delete workflow
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/**
 * The test panel.
 *
 * Runs the real engine in DRY_RUN — same trigger matching, same condition
 * evaluation — with only the outbound provider call suppressed. A test that
 * took a different code path would tell the user very little, since what they
 * actually want to know is whether their conditions match real wording.
 */
function TestDialog({
  open,
  onOpenChange,
  workflowId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
}) {
  const test = useTestWorkflow(workflowId);
  const [text, setText] = React.useState("How much is this?");
  const [username, setUsername] = React.useState("test_user");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) test.reset();
      }}
      title="Test this workflow"
      description="Nothing is sent to Instagram. This only shows whether your conditions match."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          test.mutate({ text, authorUsername: username, postId: "sample_post" });
        }}
        className="space-y-4"
      >
        <Field>
          <FieldLabel>Sample text</FieldLabel>
          <FieldInput
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="How much is this?"
          />
        </Field>

        <Field>
          <FieldLabel>From username</FieldLabel>
          <FieldInput value={username} onChange={(event) => setUsername(event.target.value)} />
        </Field>

        {test.isError && <InlineError message={errorMessage(test.error)} />}

        {test.isSuccess && (
          <div
            role="status"
            className={
              test.data.matched
                ? "rounded-md border border-success-200 bg-success-50 px-3.5 py-3 text-[13px] text-success-700"
                : "rounded-md border border-border bg-ink-50 px-3.5 py-3 text-[13px] text-ink-600"
            }
          >
            {test.data.matched
              ? "Conditions matched — this workflow would have run its actions."
              : "Conditions did not match. Open the run history below to see which one stopped it."}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="submit" loading={test.isPending}>
            Run test
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
