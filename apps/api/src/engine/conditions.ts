import type { ConditionOperator } from "@socialpilot/contracts";

/**
 * Condition evaluation.
 *
 * Pure functions over plain objects: no database, no provider, no Express.
 * That is what lets the matching rules be unit-tested exhaustively and read in
 * one sitting, and it is the single most valuable thing carried over from the
 * audited system — its matcher was pure for the same reason, which is why it
 * had tests at all.
 */

export interface EvaluableCondition {
  field: string;
  operator: ConditionOperator;
  value: string;
}

/**
 * Comparison normalization: trim, then casefold.
 *
 * `toLowerCase` is not enough for non-ASCII input — Turkish dotless ı and
 * German ß both compare wrongly under it. `toLocaleLowerCase` would be worse,
 * since the result would depend on the server's locale. Normalizing to NFKC
 * first and lowercasing without a locale gives the same answer everywhere.
 */
function normalize(input: string): string {
  return input.normalize("NFKC").trim().toLowerCase();
}

export function applyOperator(
  operator: ConditionOperator,
  actual: string,
  expected: string
): boolean {
  const a = normalize(actual);
  const b = normalize(expected);

  switch (operator) {
    case "equals":
      return a === b;
    case "not_equals":
      return a !== b;
    case "contains":
      return a.includes(b);
    case "not_contains":
      return !a.includes(b);
    case "starts_with":
      return a.startsWith(b);
    case "ends_with":
      return a.endsWith(b);
    default: {
      // Exhaustiveness: adding an operator to the enum without handling it here
      // becomes a compile error rather than a silent false at runtime.
      const unreachable: never = operator;
      throw new Error(`Unhandled operator: ${String(unreachable)}`);
    }
  }
}

export interface EvaluationResult {
  matched: boolean;
  /** Which condition rejected the event. Surfaced in the execution record so a user can see why nothing happened. */
  failedAt: number | null;
  reason: string | null;
}

/**
 * Evaluates conditions against the variable bag.
 *
 * Conditions are ANDed, and evaluation short-circuits on the first failure so
 * the reported reason is the first thing that did not match rather than the
 * last.
 *
 * A missing field is the case worth being careful about. A condition reading
 * `comment.text` when the event carries no text evaluates **false for every
 * operator, including the negative ones**. Treating a missing field as an empty
 * string would make `not_contains` vacuously true and fire a workflow on an
 * event it was never meant to see — the audited system encoded the same
 * fail-closed rule for its follower check, and generalising it is what keeps a
 * negative condition from becoming a catch-all.
 */
export function evaluateConditions(
  conditions: readonly EvaluableCondition[],
  variables: Readonly<Record<string, string>>
): EvaluationResult {
  // No conditions means "every event of this trigger type". That is a
  // deliberate, documented default, not an oversight.
  if (conditions.length === 0) return { matched: true, failedAt: null, reason: null };

  for (let index = 0; index < conditions.length; index += 1) {
    const condition = conditions[index];
    if (!condition) continue;

    // Own properties only, for the same reason interpolation checks: a plain
    // lookup walks the prototype chain and would resolve a field named
    // `constructor` to a function rather than reporting it absent. The field
    // set is closed today, so this is defence in depth rather than a live hole.
    const actual = Object.hasOwn(variables, condition.field)
      ? variables[condition.field]
      : undefined;

    if (actual === undefined) {
      return {
        matched: false,
        failedAt: index,
        reason: `This event has no ${condition.field}.`,
      };
    }

    if (!applyOperator(condition.operator, actual, condition.value)) {
      return {
        matched: false,
        failedAt: index,
        reason: `${condition.field} does not ${condition.operator.replace(/_/g, " ")} "${condition.value}".`,
      };
    }
  }

  return { matched: true, failedAt: null, reason: null };
}
