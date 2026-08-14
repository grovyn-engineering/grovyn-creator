import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import type { Metric } from "@/types";
import { computeDelta, formatCount } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * A headline figure with its period-over-period change.
 *
 * `invertDelta` exists because "up" is not universally good: more failures
 * rising is bad, more successes rising is good. Colouring by direction alone
 * would paint a growing failure count green, which is exactly the kind of
 * detail that makes a dashboard quietly untrustworthy.
 */
export function MetricTile({
  label,
  metric,
  hint,
  invertDelta = false,
  emphasis = false,
}: {
  label: string;
  metric: Metric;
  hint?: string;
  invertDelta?: boolean;
  emphasis?: boolean;
}) {
  const delta = computeDelta(metric.value, metric.previous);

  const isGood =
    delta?.direction === "flat"
      ? null
      : delta
        ? invertDelta
          ? delta.direction === "down"
          : delta.direction === "up"
        : null;

  const Icon =
    delta?.direction === "up"
      ? ArrowUpRight
      : delta?.direction === "down"
        ? ArrowDownRight
        : ArrowRight;

  return (
    <div className="px-5 py-4">
      <p className="text-[13px] font-medium text-ink-500">{label}</p>

      <div className="mt-2 flex items-baseline gap-2.5">
        <span
          className={cn(
            "tabular font-semibold text-ink-900",
            emphasis ? "text-[28px] leading-9" : "text-2xl leading-8"
          )}
        >
          {formatCount(metric.value)}
        </span>

        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[12px] font-medium",
              isGood === null && "text-ink-400",
              isGood === true && "text-success-600",
              isGood === false && "text-danger-600"
            )}
          >
            <Icon className="size-3" aria-hidden="true" />
            {delta.label}
          </span>
        )}
      </div>

      {/*
        Says what the comparison is against. A bare "+12%" invites the reader to
        assume whichever baseline flatters them.
      */}
      <p className="mt-1 text-[12px] text-ink-400">
        {hint ?? (delta ? "vs previous period" : "no prior data to compare")}
      </p>
    </div>
  );
}
