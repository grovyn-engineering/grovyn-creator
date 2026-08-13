/**
 * Background worker process.
 *
 * Run separately from the API (`npm run dev:worker`, or a second container in
 * production). Keeping them apart means a burst of webhook processing cannot
 * starve HTTP requests of event-loop time, and the two can be scaled
 * independently — webhook volume and dashboard traffic have nothing to do with
 * each other.
 */
import { EnvironmentError } from "./config/env.js";

async function main(): Promise<void> {
  const { env, hasQueue } = await import("./config/env.js");
  const { logger } = await import("./config/logger.js");

  if (!hasQueue) {
    process.stderr.write(
      "\nThe worker needs REDIS_URL. Without it the API processes events in-process and no worker is required.\n\n"
    );
    process.exit(78);
  }

  const { Worker } = await import("bullmq");
  const { WEBHOOK_QUEUE, getRedisConnection, closeQueues } = await import("./jobs/queue.js");
  const { processWebhookEventById } = await import("./jobs/webhook-event.processor.js");
  const { disconnectPrisma } = await import("./config/prisma.js");

  const worker = new Worker<{ webhookEventId: string }>(
    WEBHOOK_QUEUE,
    async (job) => {
      await processWebhookEventById(job.data.webhookEventId);
    },
    {
      connection: getRedisConnection(),
      // Modest concurrency: each job makes outbound calls to Meta, and Meta
      // rate-limits per account. Running dozens in parallel would convert
      // throughput into 429s and retries.
      concurrency: 5,
      // A ceiling below Meta's own limits, so backoff is rarely needed at all.
      limiter: { max: 30, duration: 1_000 },
    }
  );

  worker.on("failed", (job, error) => {
    logger.error(
      { err: error, jobId: job?.id, attempts: job?.attemptsMade },
      "webhook job failed"
    );
  });

  worker.on("completed", (job) => {
    logger.debug({ jobId: job.id }, "webhook job completed");
  });

  worker.on("error", (error) => {
    logger.error({ err: error }, "worker error");
  });

  logger.info({ queue: WEBHOOK_QUEUE, env: env.NODE_ENV }, "SocialPilot worker started");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "worker shutting down");
    // `close()` waits for in-flight jobs, so a job is never abandoned midway
    // through its outbound calls — which would leave an execution row RUNNING.
    await worker.close();
    await closeQueues();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  if (error instanceof EnvironmentError) {
    process.stderr.write(`${error.report}\n`);
    process.exit(78);
  }
  process.stderr.write(`Worker failed to start: ${String(error)}\n`);
  process.exit(1);
});
