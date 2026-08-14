import { describe, expect, it } from "vitest";
import { applyOperator, evaluateConditions } from "./conditions.js";

describe("applyOperator", () => {
  it("compares case-insensitively", () => {
    expect(applyOperator("equals", "PRICE", "price")).toBe(true);
    expect(applyOperator("contains", "How much is the PRICE?", "price")).toBe(true);
  });

  it("trims both sides before comparing", () => {
    expect(applyOperator("equals", "  price  ", "price")).toBe(true);
    expect(applyOperator("starts_with", "  price is", " price")).toBe(true);
  });

  it("handles each operator", () => {
    expect(applyOperator("equals", "abc", "abc")).toBe(true);
    expect(applyOperator("not_equals", "abc", "xyz")).toBe(true);
    expect(applyOperator("contains", "abcdef", "cde")).toBe(true);
    expect(applyOperator("not_contains", "abcdef", "xyz")).toBe(true);
    expect(applyOperator("starts_with", "abcdef", "abc")).toBe(true);
    expect(applyOperator("ends_with", "abcdef", "def")).toBe(true);
  });

  /**
   * Unicode normalization matters because Instagram comments routinely carry
   * composed and decomposed forms of the same character. "café" typed on a Mac
   * and "café" pasted from Windows are different byte sequences that must
   * compare equal — a user writing a condition cannot be expected to know which
   * form their commenters will send.
   */
  it("normalizes composed and decomposed unicode to the same value", () => {
    const composed = "café"; // é as one code point
    const decomposed = "café"; // e + combining acute
    expect(applyOperator("equals", composed, decomposed)).toBe(true);
    expect(applyOperator("contains", `I love ${decomposed}`, composed)).toBe(true);
  });
});

describe("evaluateConditions", () => {
  const variables = {
    "comment.text": "How much is the price?",
    "comment.author_username": "curious_buyer",
    "comment.post_id": "post_123",
  };

  it("matches every event when there are no conditions", () => {
    expect(evaluateConditions([], variables).matched).toBe(true);
  });

  it("ANDs conditions and short-circuits on the first failure", () => {
    const result = evaluateConditions(
      [
        { field: "comment.text", operator: "contains", value: "price" },
        { field: "comment.author_username", operator: "equals", value: "someone_else" },
        { field: "comment.post_id", operator: "equals", value: "post_123" },
      ],
      variables
    );

    expect(result.matched).toBe(false);
    // Index 1, not 2 — evaluation stopped at the first failure so the reported
    // reason is the thing that actually rejected the event.
    expect(result.failedAt).toBe(1);
    expect(result.reason).toContain("comment.author_username");
  });

  it("matches when every condition holds", () => {
    const result = evaluateConditions(
      [
        { field: "comment.text", operator: "contains", value: "price" },
        { field: "comment.post_id", operator: "equals", value: "post_123" },
      ],
      variables
    );
    expect(result.matched).toBe(true);
    expect(result.failedAt).toBeNull();
  });

  /**
   * The fail-closed rule, and the most important test in this file.
   *
   * A missing field must evaluate false for *every* operator, negatives
   * included. If a missing field were treated as an empty string, then
   * `not_contains "price"` would be vacuously true and the workflow would fire
   * on a direct message that has no comment text at all — acting on an event it
   * was never written for.
   */
  it("fails closed on a missing field, including for negative operators", () => {
    const noText = { "comment.author_username": "someone" };

    for (const operator of ["equals", "contains", "starts_with", "ends_with"] as const) {
      expect(
        evaluateConditions([{ field: "comment.text", operator, value: "price" }], noText).matched
      ).toBe(false);
    }

    for (const operator of ["not_equals", "not_contains"] as const) {
      const result = evaluateConditions(
        [{ field: "comment.text", operator, value: "price" }],
        noText
      );
      expect(result.matched).toBe(false);
      expect(result.reason).toContain("no comment.text");
    }
  });

  it("distinguishes an empty string from a missing field", () => {
    // An empty comment genuinely does not contain "price", so this is a normal
    // non-match rather than the missing-field case.
    const result = evaluateConditions(
      [{ field: "comment.text", operator: "contains", value: "price" }],
      { "comment.text": "" }
    );
    expect(result.matched).toBe(false);
    expect(result.reason).not.toContain("no comment.text");
  });
});
