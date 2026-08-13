import { PrismaClient } from "@prisma/client";
import { isDevelopment, isProduction } from "./env.js";
import { logger } from "./logger.js";

/**
 * One client for the process. `tsx watch` re-imports modules on every save,
 * and a fresh PrismaClient per reload exhausts Postgres' connection limit
 * within a few minutes of editing, so the instance is parked on globalThis in
 * development and reused.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction
      ? [{ emit: "event", level: "error" }]
      : [
          { emit: "event", level: "error" },
          { emit: "event", level: "warn" },
        ],
  });

prisma.$on("error" as never, (e: unknown) => {
  logger.error({ prisma: e }, "prisma error");
});

if (!isProduction) {
  prisma.$on("warn" as never, (e: unknown) => {
    logger.warn({ prisma: e }, "prisma warning");
  });
}

if (isDevelopment) globalForPrisma.prisma = prisma;

/** Transaction client type, for repository methods that participate in one. */
export type PrismaTransaction = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Either the shared client or an open transaction. Repositories take this so
 * the same method works standalone and inside `prisma.$transaction`, which is
 * what lets a workflow write its conditions and actions atomically without a
 * duplicate set of transaction-aware methods.
 */
export type Db = PrismaClient | PrismaTransaction;

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
