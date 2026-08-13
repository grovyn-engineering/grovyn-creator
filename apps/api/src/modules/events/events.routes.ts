import { Router } from "express";
import type { Response } from "express";
import type { Paginated, PaginationQuery, WebhookEventSummary } from "@socialpilot/contracts";
import {
  normalizedEventSchema,
  paginationQuerySchema,
  webhookEventTypeSchema,
} from "@socialpilot/contracts";
import { prisma } from "../../config/prisma.js";
import { ok } from "../../http/respond.js";
import { validateQuery, validatedQuery } from "../../http/validate.js";
import { requireAuth } from "../../middleware/authenticate.js";
import {
  requireWorkspace,
  withWorkspace,
  type WorkspaceRequest,
} from "../../middleware/workspace.js";
import { buildPage, cursorFilter, decodeCursor } from "../../utils/cursor.js";
import { summarize } from "../../engine/normalizer.js";

/**
 * The Instagram activity page: what actually arrived from Meta, and whether it
 * produced anything.
 *
 * This is the screen that answers "my workflow didn't fire — did the event even
 * reach you?", which is otherwise unanswerable without database access. It
 * returns the normalized form only; Meta's raw payload stays in the database
 * for diagnostics and is never part of a response.
 */
export const eventsRouter: Router = Router();

const querySchema = paginationQuerySchema.extend({
  eventType: webhookEventTypeSchema.optional(),
});

eventsRouter.use(requireAuth, requireWorkspace, validateQuery(querySchema));

eventsRouter.get(
  "/",
  withWorkspace(async (req: WorkspaceRequest, res: Response) => {
    const query = validatedQuery<PaginationQuery & { eventType?: string }>(req);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await prisma.webhookEvent.findMany({
      where: {
        workspaceId: req.workspace.id,
        ...(query.eventType ? { eventType: query.eventType as never } : {}),
        ...(cursor ? cursorFilter(cursor, "createdAt") : {}),
      },
      select: {
        id: true,
        eventId: true,
        eventType: true,
        processed: true,
        processedAt: true,
        error: true,
        normalized: true,
        createdAt: true,
        _count: { select: { executions: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });

    const page = buildPage(rows, query.limit, (row) => row.createdAt);

    const items: WebhookEventSummary[] = page.items.map((row) => {
      const parsed = row.normalized ? normalizedEventSchema.safeParse(row.normalized) : null;
      return {
        id: row.id,
        eventType: row.eventType,
        eventId: row.eventId,
        processed: row.processed,
        processedAt: row.processedAt?.toISOString() ?? null,
        error: row.error,
        // Zero means nothing matched — which is exactly the diagnosis this
        // page exists to deliver.
        executionCount: row._count.executions,
        summary: parsed?.success ? summarize(parsed.data) : "Event received",
        receivedAt: row.createdAt.toISOString(),
      };
    });

    const response: Paginated<WebhookEventSummary> = {
      items,
      nextCursor: page.nextCursor,
    };

    ok(res, response);
  })
);
