import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import type { ExecutionStatus, WorkflowStatus } from "@/types";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px] font-medium leading-5 whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-ink-100 text-ink-700",
        success: "bg-success-50 text-success-700",
        warning: "bg-warning-50 text-warning-700",
        danger: "bg-danger-50 text-danger-700",
        accent: "bg-accent-50 text-accent-700",
        outline: "border border-border text-ink-600",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Renders a leading dot. Used where the badge is a live state rather than a label. */
  dot?: boolean;
}

export function Badge({ className, tone, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            tone === "success" && "bg-success-600",
            tone === "warning" && "bg-warning-600",
            tone === "danger" && "bg-danger-600",
            tone === "accent" && "bg-accent-500",
            (!tone || tone === "neutral" || tone === "outline") && "bg-ink-400"
          )}
        />
      )}
      {children}
    </span>
  );
}

/**
 * Status badges are centralised so the same state always looks the same.
 *
 * Colour is never the only signal — each carries a word too. A user who cannot
 * distinguish the green from the red still reads "Succeeded" or "Failed", which
 * is the accessibility requirement and also just clearer in a dense table.
 */
export function WorkflowStatusBadge({ status }: { status: WorkflowStatus }) {
  switch (status) {
    case "ACTIVE":
      return <Badge tone="success" dot>Active</Badge>;
    case "PAUSED":
      return <Badge tone="warning" dot>Paused</Badge>;
    case "DRAFT":
      return <Badge tone="neutral" dot>Draft</Badge>;
  }
}

export function ExecutionStatusBadge({ status }: { status: ExecutionStatus }) {
  switch (status) {
    case "SUCCESS":
      return <Badge tone="success">Succeeded</Badge>;
    case "FAILED":
      return <Badge tone="danger">Failed</Badge>;
    case "SKIPPED":
      // Neutral, not a warning. A workflow correctly declining to act on an
      // irrelevant comment is the system working as intended, and colouring it
      // as a problem would train users to distrust their own precise conditions.
      return <Badge tone="neutral">Skipped</Badge>;
    case "RUNNING":
      return <Badge tone="accent" dot>Running</Badge>;
    case "PENDING":
      return <Badge tone="outline">Pending</Badge>;
  }
}
