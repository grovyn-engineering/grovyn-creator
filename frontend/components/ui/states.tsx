import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Loading, empty, and error states.
 *
 * Centralised because these are the screens users actually spend time looking
 * at — a dashboard is empty on day one, loading on every visit, and broken
 * occasionally — and because inconsistency here is what makes an application
 * feel unfinished.
 */

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("skeleton rounded-md", className)}
      // Decorative: the surrounding region announces its own busy state, and
      // announcing each shimmer block would be noise.
      aria-hidden="true"
      {...props}
    />
  );
}

/**
 * Wraps a loading region so assistive technology is told something is coming.
 * A visual skeleton alone communicates nothing to a screen reader.
 */
export function LoadingRegion({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/**
 * Every empty state answers three questions: what is empty, why it matters,
 * and what to do next. An empty state that only says "No workflows" leaves a
 * new user with nowhere to go.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      {Icon && (
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-border bg-ink-50">
          <Icon className="size-5 text-ink-400" aria-hidden="true" />
        </div>
      )}
      <h3 className="text-[15px] font-semibold text-ink-900">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-6 text-ink-500">{description}</p>
      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

/**
 * An error a user can act on.
 *
 * Never renders a status code or a stack trace. The API already returns a
 * user-safe sentence; this presents it and offers the retry, because "500
 * Internal Server Error" tells a customer nothing they can use.
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  action,
  className,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-danger-200 bg-danger-50">
        <AlertTriangle className="size-5 text-danger-600" aria-hidden="true" />
      </div>
      <h3 className="text-[15px] font-semibold text-ink-900">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-6 text-ink-500">{message}</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            Try again
          </Button>
        )}
        {action}
      </div>
    </div>
  );
}

/** Inline error for a panel inside an otherwise working page. */
export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-danger-200 bg-danger-50 px-3.5 py-3">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger-600" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5 text-danger-700">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 text-[13px] font-medium text-danger-700 underline underline-offset-2 hover:no-underline"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
