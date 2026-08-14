import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  conditionFieldSchema,
  conditionOperatorSchema,
  errorCodeSchema,
  executionModeSchema,
  executionStatusSchema,
  instagramAccountStatusSchema,
  webhookEventTypeSchema,
  workflowActionTypeSchema,
  workflowStatusSchema,
  workflowTriggerTypeSchema,
  workspaceRoleSchema,
} from "../contracts/index.js";

/**
 * Contract drift between the backend and the frontend's copy.
 *
 * The frontend restates the subset of the contract it needs in
 * `frontend/types/`, so the two applications stay independently deployable —
 * neither build reaches into the other's source tree. The cost of that
 * independence is that the definitions can drift, and drift here is nasty: the
 * API starts returning a value the UI has no branch for, and it surfaces as a
 * blank badge or a crash far from the change that caused it.
 *
 * This test closes that gap without reintroducing the coupling. It reads the
 * frontend's file **as text** rather than importing it — so there is no module
 * resolution across the boundary, no shared tsconfig, and nothing that survives
 * into either build. The check exists only in CI.
 *
 * If the frontend directory is not present (the backend deployed on its own,
 * for instance) the test skips rather than fails. It is a guard against a
 * mistake, not a deployment requirement.
 */

const FRONTEND_ENUMS = join(import.meta.dirname, "../../../frontend/types/enums.ts");
const FRONTEND_API = join(import.meta.dirname, "../../../frontend/types/api.ts");

/**
 * Pulls the members out of a `export const NAME = [...] as const;` declaration.
 *
 * Deliberately simple: the frontend's enums file is a flat list of string
 * literal arrays by convention, and a parser sophisticated enough to handle
 * anything else would be hiding the fact that the convention had been broken.
 */
function readConstArray(source: string, name: string): string[] | null {
  const match = new RegExp(
    `export const ${name}\\s*(?::[^=]+)?=\\s*\\[([\\s\\S]*?)\\]\\s*as const`,
    "m"
  ).exec(source);

  if (!match?.[1]) return null;

  return [...match[1].matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((v): v is string => typeof v === "string");
}

const frontendAvailable = existsSync(FRONTEND_ENUMS);

describe.skipIf(!frontendAvailable)("contract drift: backend ↔ frontend/types", () => {
  const enumsSource = frontendAvailable ? readFileSync(FRONTEND_ENUMS, "utf8") : "";
  const apiSource = existsSync(FRONTEND_API) ? readFileSync(FRONTEND_API, "utf8") : "";

  const cases: Array<{ constName: string; backend: readonly string[]; source: () => string }> = [
    { constName: "WORKSPACE_ROLES", backend: workspaceRoleSchema.options, source: () => enumsSource },
    {
      constName: "INSTAGRAM_ACCOUNT_STATUSES",
      backend: instagramAccountStatusSchema.options,
      source: () => enumsSource,
    },
    { constName: "WORKFLOW_STATUSES", backend: workflowStatusSchema.options, source: () => enumsSource },
    {
      constName: "WORKFLOW_TRIGGER_TYPES",
      backend: workflowTriggerTypeSchema.options,
      source: () => enumsSource,
    },
    { constName: "CONDITION_FIELDS", backend: conditionFieldSchema.options, source: () => enumsSource },
    {
      constName: "CONDITION_OPERATORS",
      backend: conditionOperatorSchema.options,
      source: () => enumsSource,
    },
    {
      constName: "WORKFLOW_ACTION_TYPES",
      backend: workflowActionTypeSchema.options,
      source: () => enumsSource,
    },
    {
      constName: "EXECUTION_STATUSES",
      backend: executionStatusSchema.options,
      source: () => enumsSource,
    },
    { constName: "EXECUTION_MODES", backend: executionModeSchema.options, source: () => enumsSource },
    {
      constName: "WEBHOOK_EVENT_TYPES",
      backend: webhookEventTypeSchema.options,
      source: () => enumsSource,
    },
    { constName: "ERROR_CODES", backend: errorCodeSchema.options, source: () => apiSource },
  ];

  for (const { constName, backend, source } of cases) {
    it(`${constName} matches`, () => {
      const frontend = readConstArray(source(), constName);

      expect(
        frontend,
        `${constName} was not found in frontend/types. If it was renamed, update this test; ` +
          `if it was deleted, the UI can no longer render every value the API returns.`
      ).not.toBeNull();

      // Sorted, because declaration order is presentation and carries no meaning.
      expect(
        [...(frontend ?? [])].sort(),
        `${constName} differs between backend/src/contracts and frontend/types. ` +
          `The backend is authoritative — mirror the change into frontend/types.`
      ).toEqual([...backend].sort());
    });
  }

  it("the frontend does not describe the encrypted access token", () => {
    const instagram = join(import.meta.dirname, "../../../frontend/types/instagram.ts");
    if (!existsSync(instagram)) return;

    const source = readFileSync(instagram, "utf8");

    // Not a drift check — a standing assertion. The backend's
    // SAFE_ACCOUNT_SELECT excludes the token from every response, so a frontend
    // type describing one would mean somebody had changed that.
    expect(source).not.toMatch(/accessToken(?!Encrypted\b)\s*[?:]/);
    expect(source).not.toContain("accessTokenEncrypted:");
  });
});
