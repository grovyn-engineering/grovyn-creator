/**
 * Process entry point.
 *
 * Configuration is validated before anything else is imported, so a missing
 * variable produces a readable report rather than a stack trace from whichever
 * module happened to read it first. That is why `./config/env.js` is imported
 * ahead of the app.
 */
import { EnvironmentError } from "./config/env.js";

async function main(): Promise<void> {
  const { env, hasQueue, isProduction } = await import("./config/env.js");
  const { logger } = await import("./config/logger.js");
  const { createApp } = await import("./app.js");
  const { prisma, disconnectPrisma } = await import("./config/prisma.js");

  // Fail fast on an unreachable database rather than serving 500s until
  // someone notices. A container platform will restart and back off.
  await prisma.$queryRaw`SELECT 1`;

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        queue: hasQueue ? "bullmq" : "inline",
        instagram: env.USE_MOCK_INSTAGRAM ? "mock" : "live",
      },
      `SocialPilot API listening on ${env.BACKEND_URL}`
    );

    if (env.USE_MOCK_INSTAGRAM && !isProduction) {
      logger.warn(
        "USE_MOCK_INSTAGRAM is on — Instagram OAuth and actions are simulated locally."
      );
    }
    if (!hasQueue) {
      logger.warn(
        "REDIS_URL is not set — webhook events are processed in-process and will not survive a restart."
      );
    }
  });

  // Without this, a slow client can hold a socket open indefinitely.
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;

  /**
   * Graceful shutdown. Stop accepting connections, let in-flight requests
   * finish, then close the pool. Exiting immediately would abort a request
   * mid-transaction, which for the workflow engine means an execution row
   * stuck in RUNNING forever.
   */
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");

    const forced = setTimeout(() => {
      logger.error("shutdown timed out; forcing exit");
      process.exit(1);
    }, 15_000);
    // Do not let the timer itself keep the process alive.
    forced.unref();

    server.close(async () => {
      try {
        const { closeQueues } = await import("./jobs/queue.js");
        await closeQueues();
      } catch {
        // Queues were never started. Nothing to close.
      }
      await disconnectPrisma();
      clearTimeout(forced);
      logger.info("shutdown complete");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // An unhandled rejection leaves the process in an unknown state. Log it and
  // let the platform restart rather than continuing to serve from it.
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "unhandled promise rejection");
    void shutdown("unhandledRejection");
  });
  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "uncaught exception");
    void shutdown("uncaughtException");
  });
}

main().catch((error: unknown) => {
  if (error instanceof EnvironmentError) {
    // A configuration problem is a message, not a crash. No stack trace.
    process.stderr.write(`${error.report}\n`);
    process.exit(78); // EX_CONFIG
  }
  process.stderr.write(`Failed to start: ${String(error)}\n`);
  if (error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
