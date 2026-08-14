import pino from "pino";
import { env, isDevelopment, isTest } from "./env.js";

/**
 * Paths scrubbed from every log record.
 *
 * Redaction is configured centrally rather than left to call sites because the
 * dangerous case is the one nobody thought about — an error object logged
 * whole, a request body echoed during debugging. The rule the product commits
 * to is "an access token never appears in a log", and that only holds if it is
 * enforced here.
 */
const REDACTED = [
  "req.headers.cookie",
  "req.headers.authorization",
  "req.headers['x-hub-signature-256']",
  "res.headers['set-cookie']",
  "password",
  "*.password",
  "newPassword",
  "currentPassword",
  "passwordHash",
  "*.passwordHash",
  "accessToken",
  "*.accessToken",
  "access_token",
  "*.access_token",
  "accessTokenEncrypted",
  "*.accessTokenEncrypted",
  "appSecret",
  "*.appSecret",
  "META_APP_SECRET",
  "SESSION_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "DATABASE_URL",
  "state",
  "code",
];

export const logger = pino({
  level: isTest ? "silent" : env.LOG_LEVEL,
  redact: { paths: REDACTED, censor: "[redacted]" },
  base: { service: "socialpilot-api" },
  // Production ships raw JSON to be picked up by the platform's log shipper.
  // pino-pretty is a devDependency and must not be reachable in a production
  // image, so the transport is only configured in development.
  ...(isDevelopment
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname,service" },
        },
      }
    : {}),
});

export type Logger = typeof logger;
