"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { CreateWorkflowRequest } from "@/types";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { WorkflowBuilder } from "@/components/workflows/workflow-builder";
import { useCreateWorkflow } from "@/features/workflows/use-workflows";
import { errorMessage } from "@/lib/api";

export default function NewWorkflowPage() {
  const create = useCreateWorkflow();

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
        title="New workflow"
        description="Describe what should happen, and when. You can test it before enabling it."
      />

      <WorkflowBuilder
        submitLabel="Create workflow"
        isSubmitting={create.isPending}
        onSubmit={async (values: CreateWorkflowRequest) => {
          try {
            await create.mutateAsync(values);
          } catch (error) {
            // Rethrown as a plain Error so the builder can show it in its
            // form-level banner; the ApiClientError's own field errors have
            // already been applied where they belong.
            throw new Error(errorMessage(error));
          }
        }}
        secondaryActions={
          <Button variant="secondary" asChild>
            <Link href="/workflows">Cancel</Link>
          </Button>
        }
      />
    </>
  );
}
