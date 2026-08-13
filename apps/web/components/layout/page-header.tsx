import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The heading block every page opens with.
 *
 * Centralised so the h1, the description, and the action row keep identical
 * spacing and type across the product — inconsistent page headers are one of
 * the clearest tells that a UI was assembled screen by screen.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
        {description && (
          <p className="mt-1 text-[13px] leading-6 text-ink-500">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
