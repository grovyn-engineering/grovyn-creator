import { AppError } from "../http/errors.js";

/**
 * Keyset pagination cursors.
 *
 * The cursor is `<ISO timestamp>|<id>` in base64url. Both parts are needed:
 * executions and events are written in bursts and frequently share a
 * millisecond, so a timestamp alone either skips rows or repeats them at the
 * page boundary. The id breaks the tie and makes the ordering total.
 *
 * base64 here is encoding, not protection — anyone can decode it. It exists so
 * clients treat the value as opaque and do not build their own, which is what
 * lets the encoding change later.
 */

export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    throw AppError.validation("That page cursor is not valid.");
  }

  const separator = decoded.indexOf("|");
  if (separator === -1) throw AppError.validation("That page cursor is not valid.");

  const timestamp = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  const createdAt = new Date(timestamp);

  if (!id || Number.isNaN(createdAt.getTime())) {
    throw AppError.validation("That page cursor is not valid.");
  }

  return { createdAt, id };
}

/**
 * Prisma `where` for "strictly older than this cursor", under a
 * `createdAt desc, id desc` ordering.
 */
export function cursorFilter(
  cursor: Cursor,
  field: string
): { OR: Array<Record<string, unknown>> } {
  return {
    OR: [
      { [field]: { lt: cursor.createdAt } },
      { [field]: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

/**
 * Trims an over-fetched page to size and derives the next cursor.
 *
 * Callers query `limit + 1` rows: the presence of that extra row is what
 * distinguishes "last page" from "a full page that happens to end exactly at
 * the boundary", which a count query cannot do without racing writes.
 */
export function buildPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  timestampOf: (row: T) => Date
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };

  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  if (!last) return { items, nextCursor: null };

  return { items, nextCursor: encodeCursor({ createdAt: timestampOf(last), id: last.id }) };
}
