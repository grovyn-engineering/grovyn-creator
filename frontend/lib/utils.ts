import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Class name composition. `twMerge` resolves Tailwind conflicts by specificity
 * of intent rather than source order, so a caller passing `px-6` reliably
 * overrides a component's own `px-4` instead of depending on which string
 * happened to come last.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Relative time, in the coarse units a person actually reads.
 *
 * Deliberately not a live-updating ticker: this appears in lists of dozens of
 * rows, and re-rendering all of them every second to advance "3 minutes ago" to
 * "4 minutes ago" is a real cost for no information.
 */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 45) return "just now";
  if (seconds < 90) return "1 min ago";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;

  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Absolute timestamp, for tooltips beside a relative one. */
export function absoluteTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Thousands separators, and compact notation past 10,000 so a KPI cannot overflow its tile. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 10_000) {
    return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
      value
    );
  }
  return new Intl.NumberFormat().format(value);
}

/** A 0–1 fraction as a percentage. Null renders as an em dash, never as 0%. */
export function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

export interface Delta {
  direction: "up" | "down" | "flat";
  label: string;
}

/**
 * Period-over-period change.
 *
 * Returns null when there is no prior data rather than reporting a rise from
 * zero — "+100%" against a baseline of nothing is noise dressed as insight,
 * and it is what makes a brand new account's dashboard look like a rocket ship.
 */
export function computeDelta(current: number, previous: number | null): Delta | null {
  if (previous === null || previous === 0) return null;

  const change = (current - previous) / previous;
  // Under half a percent is rounding, not a trend.
  if (Math.abs(change) < 0.005) return { direction: "flat", label: "no change" };

  return {
    direction: change > 0 ? "up" : "down",
    label: `${change > 0 ? "+" : ""}${Math.round(change * 100)}%`,
  };
}

/** `PAUSED` → `Paused`. For enum values shown to a user. */
export function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
