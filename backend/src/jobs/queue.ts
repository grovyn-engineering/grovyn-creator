import { Queue, type JobsOptions } from "bullmq";
// Named import, not default: ioredis is CommonJS, and under NodeNext its
// default export is the module namespace rather than the constructor.
import { Redis } from "ioredis";
import { env, hasQueue } from "../config/env.js";
import { logger } from "../config/logger.js";

/**
 * Background job plumbing.
 *
 * The webhook endpoint must return 200 quickly — Meta treats a slow response as
 * a failed delivery and, after enough of them, disables the subscription. So
 * the endpoint persists the event and hands off; everything after that happens
 * here.
 *
 * Redis is optional in development. Without it, `enqueue` runs the handler
 * in-process instead, which keeps the whole product usable on a laptop with
 * nothing but Postgres running. Production requires it — see env.ts — because
 * in-process work is lost on restart and cannot be retried.
 */

export const WEBHOOK_QUEUE = "webhook-events";

export interface ProcessWebhookEventJob {
  /** Primary key of the persisted WebhookEvent row. */
  webhookEventId: string;
}

let connection: Redis | null = null;
let webhookQueue: Queue<ProcessWebhookEventJob> | null = null;

/**
 * BullMQ requires `maxRetriesPerRequest: null` on its connection: the default
 * makes ioredis fail commands after a few attempts during a reconnect, which
 * BullMQ surfaces as jobs silently vanishing.
 */
function getConnection(): Redis {
  if (connection) return connection;
  if (!env.REDIS_URL) throw new Error("REDIS_URL is not configured");

  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  client.on("error", (error) => {
    logger.error({ err: error }, "redis connection error");
  });

  connection = client;
  return client;
}

export function getWebhookQueue(): Queue<ProcessWebhookEventJob> | null {
  if (!hasQueue) return null;
  if (!webhookQueue) {
    webhookQueue = new Queue<ProcessWebhookEventJob>(WEBHOOK_QUEUE, {
      connection: getConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return webhookQueue;
}

/**
 * Retry policy.
 *
 * Exponential backoff from two seconds, five attempts, so a transient Meta
 * outage or a brief database blip recovers on its own. Beyond that the job is
 * kept as failed rather than retried forever — a payload the normalizer cannot
 * handle will fail identically on attempt five hundred, and the row stays in
 * the database either way, so nothing is lost by stopping.
 *
 * Completed jobs are trimmed aggressively; failed ones are kept far longer,
 * because they are the ones anybody will want to look at.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 86_400 },
};

/**
 * Hands a persisted event to the worker, or processes it inline when no queue
 * is configured.
 *
 * The inline path is deliberately fire-and-forget: the caller is the webhook
 * request, and awaiting the engine there would reintroduce exactly the latency
 * the queue exists to avoid.
 */
export async function enqueueWebhookEvent(job: ProcessWebhookEventJob): Promise<void> {
  const queue = getWebhookQueue();

  if (!queue) {
    const { processWebhookEventById } = await import("./webhook-event.processor.js");
    void processWebhookEventById(job.webhookEventId).catch((error: unknown) => {
      logger.error(
        { err: error, webhookEventId: job.webhookEventId },
        "inline webhook processing failed"
      );
    });
    return;
  }

  await queue.add("process", job, {
    // Deduplicates at the queue level as well as the database level. Belt and
    // braces, and it keeps a redelivery from occupying a worker slot at all.
    jobId: job.webhookEventId,
  });
}

export async function closeQueues(): Promise<void> {
  await webhookQueue?.close();
  webhookQueue = null;
  if (connection) {
    await connection.quit();
    connection = null;
  }
}

export { getConnection as getRedisConnection };
