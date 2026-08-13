import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
// Named import: pino-http is CommonJS, so under NodeNext the default export is
// the module namespace rather than the factory.
import { pinoHttp } from "pino-http";
import { logger } from "../config/logger.js";

/**
 * Assigns each request an id, echoes it in a response header, and puts it on
 * `res.locals` so the error handler can include it. A user reporting "it said
 * something went wrong" can then be matched to an exact log line.
 */
export const requestContext: RequestHandler = (req, res, next) => {
  // An upstream proxy may already have assigned one; preferring it keeps a
  // single id across the whole hop chain.
  const incoming = req.get("x-request-id");
  const id = incoming && incoming.length <= 200 ? incoming : randomUUID();

  res.locals.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
};

/**
 * Access logging.
 *
 * Health checks are excluded — a container platform probes them every few
 * seconds and they would otherwise dominate the log. Successful requests log
 * at `info`, client errors at `warn`, server errors at `error`, so log level
 * alone separates "someone sent a bad request" from "we broke".
 */
export const httpLogger: RequestHandler = pinoHttp({
  logger,
  // pino-http types `res` as the bare Node ServerResponse, which has no
  // `locals`. Express's response does, and `requestContext` above has already
  // set it — so the narrowing is safe and the alternative would be a second
  // source of request ids that disagreed with the header.
  genReqId: (_req, res) => (res as unknown as { locals: { requestId: string } }).locals.requestId,
  autoLogging: {
    ignore: (req) => req.url === "/health" || req.url === "/api/health",
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  serializers: {
    // The defaults serialise every header, which is how a cookie ends up in a
    // log. Only the fields actually used for debugging are kept.
    req: (req) => ({ method: req.method, url: req.url, id: req.id }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
}) as unknown as RequestHandler;
