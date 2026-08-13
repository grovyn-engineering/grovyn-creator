/**
 * Date helpers for the dashboard's windowed aggregates.
 *
 * Everything is UTC. Bucketing by the server's local day would make the same
 * data produce different charts in different deployments, and would silently
 * shift every bucket twice a year wherever DST applies.
 */

export const MS_PER_DAY = 86_400_000;

/** Midnight UTC at the start of `date`'s day. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** `YYYY-MM-DD` in UTC — the key format the trend series uses. */
export function toUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface Window {
  from: Date;
  to: Date;
}

/**
 * The current window and the equally sized one immediately before it.
 *
 * `from` is the start of the day `days - 1` days ago, so a 7-day window covers
 * seven whole days including today rather than "168 hours ago", which would
 * put a partial day at each end and make the comparison meaningless.
 */
export function comparisonWindows(now: Date, days: number): { current: Window; previous: Window } {
  const todayStart = startOfUtcDay(now);
  const currentFrom = addDays(todayStart, -(days - 1));
  // Exclusive upper bound at tomorrow's midnight, so today counts in full and
  // a row written a millisecond from now still lands in the current window.
  const currentTo = addDays(todayStart, 1);

  return {
    current: { from: currentFrom, to: currentTo },
    previous: { from: addDays(currentFrom, -days), to: currentFrom },
  };
}

/**
 * Every day in the window as a `YYYY-MM-DD` key. Used to backfill zeros so a
 * quiet day is a gap at the baseline rather than a missing point the chart
 * would interpolate straight through.
 */
export function utcDateKeysBetween(from: Date, toExclusive: Date): string[] {
  const keys: string[] = [];
  for (let d = startOfUtcDay(from); d < toExclusive; d = addDays(d, 1)) {
    keys.push(toUtcDateKey(d));
  }
  return keys;
}
