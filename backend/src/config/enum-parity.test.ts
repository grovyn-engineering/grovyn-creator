import { describe, expect, it } from "vitest";
import {
  $Enums,
} from "@prisma/client";
import {
  auditActionSchema,
  auditEntityTypeSchema,
  conditionOperatorSchema,
  executionModeSchema,
  executionStatusSchema,
  instagramAccountStatusSchema,
  socialPlatformSchema,
  webhookEventTypeSchema,
  workflowActionTypeSchema,
  workflowStatusSchema,
  workflowTriggerTypeSchema,
  workspaceRoleSchema,
} from "../contracts/index.js";

/**
 * Enum parity between Prisma and the shared contracts.
 *
 * The same enums are declared twice — once in schema.prisma, which the database
 * enforces, and once in Zod, which the API and the frontend validate against.
 * Duplication is unavoidable: Prisma cannot import a Zod schema and the browser
 * cannot import Prisma's client.
 *
 * What is avoidable is the drift. Adding a member on one side only produces a
 * failure that is genuinely hard to diagnose — a value the database accepts and
 * the API rejects, or vice versa, surfacing as a validation error far from the
 * migration that caused it. These assertions turn that into a failing test at
 * the moment the mismatch is introduced.
 */

function assertSameMembers(
  name: string,
  prismaEnum: Record<string, string>,
  zodValues: readonly string[]
): void {
  const fromPrisma = [...Object.values(prismaEnum)].sort();
  const fromZod = [...zodValues].sort();

  expect(fromZod, `${name}: contracts and schema.prisma disagree`).toEqual(fromPrisma);
}

describe("enum parity", () => {
  it("WorkspaceRole", () => {
    assertSameMembers("WorkspaceRole", $Enums.WorkspaceRole, workspaceRoleSchema.options);
  });

  it("SocialPlatform", () => {
    assertSameMembers("SocialPlatform", $Enums.SocialPlatform, socialPlatformSchema.options);
  });

  it("InstagramAccountStatus", () => {
    assertSameMembers(
      "InstagramAccountStatus",
      $Enums.InstagramAccountStatus,
      instagramAccountStatusSchema.options
    );
  });

  it("WorkflowStatus", () => {
    assertSameMembers("WorkflowStatus", $Enums.WorkflowStatus, workflowStatusSchema.options);
  });

  it("WorkflowTriggerType", () => {
    assertSameMembers(
      "WorkflowTriggerType",
      $Enums.WorkflowTriggerType,
      workflowTriggerTypeSchema.options
    );
  });

  it("ConditionOperator", () => {
    assertSameMembers(
      "ConditionOperator",
      $Enums.ConditionOperator,
      conditionOperatorSchema.options
    );
  });

  it("WorkflowActionType", () => {
    assertSameMembers(
      "WorkflowActionType",
      $Enums.WorkflowActionType,
      workflowActionTypeSchema.options
    );
  });

  it("ExecutionStatus", () => {
    assertSameMembers("ExecutionStatus", $Enums.ExecutionStatus, executionStatusSchema.options);
  });

  it("ExecutionMode", () => {
    assertSameMembers("ExecutionMode", $Enums.ExecutionMode, executionModeSchema.options);
  });

  it("WebhookEventType", () => {
    assertSameMembers("WebhookEventType", $Enums.WebhookEventType, webhookEventTypeSchema.options);
  });

  it("AuditAction", () => {
    assertSameMembers("AuditAction", $Enums.AuditAction, auditActionSchema.options);
  });

  it("AuditEntityType", () => {
    assertSameMembers("AuditEntityType", $Enums.AuditEntityType, auditEntityTypeSchema.options);
  });
});
