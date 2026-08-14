import { randomBytes } from "node:crypto";

/**
 * Slugs are derived server-side and never accepted from a client — a slug is
 * a namespace, and letting a caller pick one lets them squat or impersonate.
 */

const MAX_BASE_LENGTH = 48;

export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    // Strip combining marks so "Café" becomes "cafe" rather than "caf".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BASE_LENGTH)
    // The slice can leave a trailing hyphen behind.
    .replace(/-+$/g, "");

  // Names made entirely of non-Latin characters legitimately reduce to nothing.
  return base || "workspace";
}

/**
 * Appends random characters to resolve a collision. Random rather than an
 * incrementing counter: a counter requires a read to discover the next free
 * value, which races with a concurrent create, and it also reveals how many
 * workspaces share a name.
 */
export function uniquifySlug(base: string): string {
  return `${base}-${randomBytes(3).toString("hex")}`;
}
