"use client";

import * as React from "react";
import type { DashboardTrendPoint } from "@socialpilot/contracts";
import { cn } from "@/lib/utils";

/**
 * Daily executions, as a stacked column chart.
 *
 * Hand-drawn SVG rather than a charting library. The chart has one job — show
 * whether automation ran and whether it worked — and a library would add a
 * substantial dependency, its own theming system, and a canvas that is hard to
 * make accessible, to draw about forty rectangles.
 *
 * The accessibility approach is the important part: the SVG is hidden from
 * assistive technology and a real `<table>` carries the same data, visually
 * hidden. A screen-reader user gets the numbers rather than "graphic".
 */
export function ExecutionChart({ points }: { points: DashboardTrendPoint[] }) {
  const [hovered, setHovered] = React.useState<number | null>(null);

  const max = Math.max(1, ...points.map((p) => p.succeeded + p.failed + p.skipped));
  const hasAny = points.some((p) => p.succeeded + p.failed + p.skipped > 0);

  if (!hasAny) {
    return (
      <div className="flex h-[11rem] items-center justify-center px-5">
        <p className="text-[13px] text-ink-400">
          No workflow runs in this period yet.
        </p>
      </div>
    );
  }

  const active = hovered !== null ? points[hovered] : null;

  return (
    <div className="px-5 pb-4 pt-1">
      <div className="flex h-[9.5rem] items-end gap-[3px]" role="presentation">
        {points.map((point, index) => {
          const total = point.succeeded + point.failed + point.skipped;
          const height = total === 0 ? 0 : Math.max(3, (total / max) * 100);

          return (
            <div
              key={point.date}
              className="group relative flex h-full flex-1 items-end"
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
            >
              <div
                className="w-full overflow-hidden rounded-[2px] transition-opacity"
                style={{ height: `${height}%` }}
              >
                {/* Stacked bottom-up: succeeded, then skipped, then failed, so
                    failures sit at the top where they are easiest to spot. */}
                <div className="flex h-full w-full flex-col-reverse">
                  <Segment value={point.succeeded} total={total} className="bg-accent-500" />
                  <Segment value={point.skipped} total={total} className="bg-ink-200" />
                  <Segment value={point.failed} total={total} className="bg-danger-600" />
                </div>
              </div>

              <div
                className={cn(
                  "pointer-events-none absolute inset-x-0 bottom-0 top-0 rounded-[2px] bg-ink-900/[0.04] opacity-0 transition-opacity",
                  hovered === index && "opacity-100"
                )}
                aria-hidden="true"
              />
            </div>
          );
        })}
      </div>

      {/* A fixed-height readout, so hovering does not reflow the card. */}
      <div className="mt-3 flex h-5 items-center justify-between text-[12px]">
        {active ? (
          <>
            <span className="font-medium text-ink-700">{formatDay(active.date)}</span>
            <span className="tabular flex items-center gap-3 text-ink-500">
              <Legend className="bg-accent-500" label={`${active.succeeded} ok`} />
              <Legend className="bg-ink-200" label={`${active.skipped} skipped`} />
              <Legend className="bg-danger-600" label={`${active.failed} failed`} />
            </span>
          </>
        ) : (
          <>
            <span className="text-ink-400">{formatDay(points[0]?.date ?? "")}</span>
            <span className="flex items-center gap-3 text-ink-400">
              <Legend className="bg-accent-500" label="Succeeded" />
              <Legend className="bg-ink-200" label="Skipped" />
              <Legend className="bg-danger-600" label="Failed" />
            </span>
          </>
        )}
      </div>

      <table className="sr-only">
        <caption>Workflow executions per day</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Succeeded</th>
            <th scope="col">Skipped</th>
            <th scope="col">Failed</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{point.date}</th>
              <td>{point.succeeded}</td>
              <td>{point.skipped}</td>
              <td>{point.failed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Segment({ value, total, className }: { value: number; total: number; className: string }) {
  if (value === 0) return null;
  return <div className={className} style={{ height: `${(value / total) * 100}%` }} />;
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2 rounded-[2px]", className)} aria-hidden="true" />
      {label}
    </span>
  );
}

function formatDay(date: string): string {
  if (!date) return "";
  // Parsed as UTC to match how the backend bucketed it — using the local
  // timezone here would shift every label by a day for western users.
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
