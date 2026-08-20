import { config as loadDotenv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { EnvironmentError } from "./environment-error.js";

/**
 * Load `.env` or `.env.production` before anything reads `process.env`.
 *
 * This has to happen here rather than in the entry point, because this module
 * validates at import time and is imported by everything — the server, the
 * worker, the seed script, and Vitest. Putting it in `server.ts` would leave
 * every other entry point without configuration.
 *
 * `dotenv` does not overwrite variables that are already set, which is the
 * behaviour we want: a real environment variable from the shell, a container,
 * or a hosting platform always wins over the file.
 *
 * Checks `process.env.DOTENV_CONFIG_PATH` first, then `.env.production` if `NODE_ENV=production`
 * and file exists, falling back to `.env`.
 */
const customEnvPath = process.env.DOTENV_CONFIG_PATH;
const prodEnvPath = path.resolve(process.cwd(), ".env.production");
const targetEnvFile = customEnvPath
  ? customEnvPath
  : (process.env.NODE_ENV === "production" && fs.existsSync(prodEnvPath))
  ? ".env.production"
  : ".env";

loadDotenv({ path: targetEnvFile, quiet: true });

/**
 * Environment validation runs once, at import time, before the server binds a
 * port. A misconfigured deployment fails immediately with a list of what is
 * wrong, rather than booting and then failing on the first request that
 * happens to need the missing value.
 */

/** Base64 decoding that reports the byte length, for key-material checks. */
function base64Bytes(value: string): number | null {
  try {
    const buf = Buffer.from(value, "base64");
    // Buffer.from is famously lenient — it silently drops invalid characters
    // rather than throwing. Re-encoding and comparing is the only reliable way
    // to tell "valid base64" from "something that partially looked like it".
    if (buf.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
      return null;
    }
    return buf.length;
  } catch {
    return null;
  }
}

const urlSchema = z
  .string()
  .url("must be an absolute URL including the scheme")
  // A trailing slash here becomes a double slash in every URL built from it.
  .transform((v) => v.replace(/\/+$/, ""));

/**
 * An optional variable that may be present but blank.
 *
 * `.env` files are written by hand, and leaving a key with no value —
 * `REDIS_URL=` — is the normal way to say "not configured". Without this,
 * `z.string().min(1).optional()` sees a present-but-empty string, skips the
 * optional branch, and fails the length check: the server then refuses to boot
 * over a variable that is genuinely optional.
 *
 * Blank and whitespace-only both collapse to undefined, so the cross-field
 * checks below can test these with a plain truthiness check.
 */
function optional<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    schema.optional()
  );
}

const rawEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),

    FRONTEND_URL: urlSchema.default("http://localhost:3000"),
    BACKEND_URL: urlSchema.default("http://localhost:5000"),

    DATABASE_URL: z.string().min(1, "is required"),

    /**
     * The direct (non-pooled) connection, used only by `prisma migrate`.
     * Optional at runtime — the server never opens it — but Prisma's CLI reads
     * it from the same .env, so it is declared here to keep the file's contract
     * in one place.
     */
    DIRECT_URL: optional(z.string().min(1)),

    /**
     * Optional. Without it the API processes webhook events inline instead of
     * through BullMQ — acceptable for local development, refused in production
     * by the cross-field check below.
     */
    REDIS_URL: optional(z.string().min(1)),

    SESSION_SECRET: z
      .string()
      .min(1, "is required")
      .refine((v) => (base64Bytes(v) ?? 0) >= 32, {
        message: "must be at least 32 bytes of base64 (openssl rand -base64 32)",
      }),

    TOKEN_ENCRYPTION_KEY: z
      .string()
      .min(1, "is required")
      .refine((v) => base64Bytes(v) === 32, {
        message: "must be exactly 32 bytes of base64 — AES-256-GCM takes a 256-bit key",
      }),

    META_APP_ID: optional(z.string().min(1)),
    META_APP_SECRET: optional(z.string().min(1)),
    META_REDIRECT_URI: optional(z.string().url()),
    META_WEBHOOK_VERIFY_TOKEN: optional(z.string().min(1)),
    /**
     * Pinned rather than floating. Meta's Graph API is versioned and each
     * version has a published deprecation date; silently following "latest"
     * would mean a breaking change arrives without a deploy.
     */
    META_GRAPH_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/, "must look like v23.0")
      .default("v23.0"),

    USE_MOCK_INSTAGRAM: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),

    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    /** Trusted proxy hop count, for correct client IPs behind a load balancer. */
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  })
  .superRefine((env, ctx) => {
    const require = (key: string, why: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: why });

    if (env.NODE_ENV === "production") {
      // The mock provider fabricates Instagram accounts and pretends actions
      // succeeded. In production that is indistinguishable from the product
      // being broken, so it is refused rather than warned about.
      if (env.USE_MOCK_INSTAGRAM) {
        require(
          "USE_MOCK_INSTAGRAM",
          "must be false in production — the mock provider returns fabricated Instagram data"
        );
      }

      for (const key of [
        "META_APP_ID",
        "META_APP_SECRET",
        "META_REDIRECT_URI",
        "META_WEBHOOK_VERIFY_TOKEN",
      ] as const) {
        if (!env[key]) require(key, "is required in production");
      }

      if (!env.REDIS_URL) {
        require(
          "REDIS_URL",
          "is required in production — inline webhook processing does not survive a restart"
        );
      }

      if (env.FRONTEND_URL.startsWith("http://")) {
        require(
          "FRONTEND_URL",
          "must use https in production — the session cookie is SameSite=None; Secure and will not be sent over http"
        );
      }
    }

    // A pooled connection string without a direct one means `prisma migrate`
    // will fail — and it fails with an error about prepared statements that
    // says nothing about pooling, which is a genuinely hard afternoon. Caught
    // here instead.
    if (/pgbouncer=true|:6543\//.test(env.DATABASE_URL) && !env.DIRECT_URL) {
      require(
        "DIRECT_URL",
        "is required when DATABASE_URL is a pooled connection — prisma migrate cannot run through PgBouncer. Use the direct URL (port 5432)."
      );
    }

    // Not production-only: a redirect URI that disagrees with the app's own
    // origin fails at Meta's end with an opaque error, and it is far cheaper
    // to catch here than in an OAuth round trip.
    if (env.META_REDIRECT_URI && !env.META_REDIRECT_URI.startsWith(env.BACKEND_URL)) {
      require(
        "META_REDIRECT_URI",
        `must start with BACKEND_URL (${env.BACKEND_URL}) — Meta redirects the browser back to this exact URL`
      );
    }

    // Live Instagram needs credentials regardless of NODE_ENV: turning the
    // mock off in development without configuring Meta produces confusing
    // runtime failures deep inside the OAuth exchange.
    if (!env.USE_MOCK_INSTAGRAM) {
      for (const key of ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"] as const) {
        if (!env[key]) {
          require(key, "is required when USE_MOCK_INSTAGRAM is false");
        }
      }
    }
  });

export type Env = z.infer<typeof rawEnvSchema>;

// Lives in its own side-effect-free module so entry points can import it
// without triggering the validation below. See environment-error.ts.
export { EnvironmentError } from "./environment-error.js";

function format(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const key = issue.path.join(".") || "(root)";
    return `  ✗ ${key}  ${issue.message}`;
  });
  return [
    "",
    "SocialPilot cannot start — the environment is not configured correctly.",
    "",
    ...lines,
    "",
    "Copy .env.example to .env and fill in the values above.",
    "",
  ].join("\n");
}

function load(): Env {
  const parsed = rawEnvSchema.safeParse(process.env);
  if (!parsed.success) throw new EnvironmentError(format(parsed.error));
  return parsed.data;
}

export const env: Env = load();

/**
 * `NEXT_PUBLIC_*` variables found in the backend's environment.
 *
 * These belong to the frontend and are *published* — Next inlines them into the
 * browser bundle at build time. One appearing here means the two `.env` files
 * have been merged or copied from each other, which is how a backend secret
 * eventually ends up in a frontend file and then in a public JavaScript bundle.
 *
 * Reported rather than fatal: the variable itself is harmless, and a shared
 * shell can legitimately have one exported. It is the *direction of drift* that
 * matters, so the server names it at startup instead of failing.
 */
export function misplacedFrontendVars(): string[] {
  return Object.keys(process.env).filter((key) => key.startsWith("NEXT_PUBLIC_"));
}

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
export const isDevelopment = env.NODE_ENV === "development";

/** True when background processing goes through BullMQ rather than inline. */
export const hasQueue = Boolean(env.REDIS_URL);

/**
 * Meta configuration, narrowed to non-optional. Reading this when the mock
 * provider is active is a programming error — the mock has no Meta config —
 * so it throws rather than returning empty strings that would fail later at
 * the Graph API with a much worse error message.
 */
export function requireMetaConfig(): {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphVersion: string;
  webhookVerifyToken: string;
} {
  const { META_APP_ID, META_APP_SECRET, META_REDIRECT_URI, META_WEBHOOK_VERIFY_TOKEN } = env;
  if (!META_APP_ID || !META_APP_SECRET || !META_REDIRECT_URI || !META_WEBHOOK_VERIFY_TOKEN) {
    throw new EnvironmentError(
      "Meta configuration was requested but META_APP_ID, META_APP_SECRET, META_REDIRECT_URI and META_WEBHOOK_VERIFY_TOKEN are not all set."
    );
  }
  return {
    appId: META_APP_ID,
    appSecret: META_APP_SECRET,
    redirectUri: META_REDIRECT_URI,
    graphVersion: env.META_GRAPH_VERSION,
    webhookVerifyToken: META_WEBHOOK_VERIFY_TOKEN,
  };
}
