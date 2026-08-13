import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../config/env.js";

/**
 * Symmetric encryption for Instagram access tokens.
 *
 * AES-256-GCM, not CBC: an access token that decrypts to attacker-chosen bytes
 * would be sent to Meta on the workspace's behalf, so the ciphertext has to be
 * authenticated, not merely confidential. GCM's tag gives that; CBC would need
 * a separate MAC and the discipline to always check it.
 *
 * Format: `v1:<iv>:<tag>:<ciphertext>`, each part base64. The version prefix
 * costs three bytes and is what makes a future algorithm or key change a
 * migration rather than a flag day — a decryptor can recognise old ciphertexts
 * instead of guessing.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
/** 96 bits is the GCM-optimal nonce size; anything else forces extra hashing. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const buf = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");
  // env.ts already enforces this; re-checked because a wrong-length key here
  // would otherwise surface as an opaque OpenSSL error at the first connect.
  if (buf.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  cachedKey = buf;
  return buf;
}

export function encryptToken(plaintext: string): string {
  if (!plaintext) throw new Error("Refusing to encrypt an empty token");

  // A fresh random IV per encryption. Reusing one under the same key breaks
  // GCM catastrophically — it leaks the XOR of the plaintexts and the
  // authentication key — so this must never be derived from the record.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Throws on tampering, on a wrong key, and on a malformed record. Callers
 * treat a throw as "this account can no longer be used" and mark it for
 * reconnection — never as "use an empty token", which would produce a
 * confusing 400 from Meta instead of an actionable message.
 */
export function decryptToken(record: string): string {
  const parts = record.split(":");
  if (parts.length !== 4) throw new Error("Malformed encrypted token record");

  const [version, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  if (version !== VERSION) throw new Error(`Unsupported token encryption version: ${version}`);

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Malformed encrypted token record");
  }

  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);

  // `final()` throws if the tag does not verify. That throw is the integrity
  // check — there is no branch to forget.
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString(
    "utf8"
  );
}

// ── Session tokens ───────────────────────────────────────────────────────

/**
 * 256 bits from the CSPRNG. base64url so it survives a cookie value without
 * escaping. Not a JWT: the session is looked up server-side anyway, so signing
 * would add work without adding a property, and a random opaque string carries
 * no claims to forge.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Sessions are stored as a hash, so a database dump does not hand over live
 * cookies. Plain SHA-256 rather than a password hash: the input is already
 * 256 bits of entropy, so there is nothing to brute-force, and lookup happens
 * on every request where Argon2's cost would be a self-inflicted DoS.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** OAuth `state`. Same reasoning as the session token. */
export function generateOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Constant-time comparison for secrets compared as strings — webhook
 * signatures, verify tokens. `===` on a string leaks position of first
 * difference through timing, which is enough to recover a secret byte by byte.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length. Hashing first makes both sides fixed-width.
  const hashA = createHash("sha256").update(bufA).digest();
  const hashB = createHash("sha256").update(bufB).digest();
  return timingSafeEqual(hashA, hashB);
}
