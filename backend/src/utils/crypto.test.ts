import { describe, expect, it } from "vitest";
import {
  decryptToken,
  encryptToken,
  generateSessionToken,
  hashSessionToken,
  safeEqual,
} from "./crypto.js";

describe("token encryption", () => {
  const token = "IGQVJXexample_long_lived_access_token_value_0123456789";

  it("round-trips", () => {
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it("never contains the plaintext", () => {
    expect(encryptToken(token)).not.toContain(token);
  });

  /**
   * A fresh IV per encryption. Reusing one under the same key breaks GCM
   * catastrophically — it leaks the XOR of the plaintexts and the
   * authentication key — so two encryptions of identical input must differ.
   */
  it("produces different ciphertext for the same input", () => {
    expect(encryptToken(token)).not.toBe(encryptToken(token));
  });

  it("carries a version prefix so the format can change later", () => {
    expect(encryptToken(token).startsWith("v1:")).toBe(true);
  });

  it("refuses to encrypt nothing", () => {
    expect(() => encryptToken("")).toThrow();
  });

  /**
   * Authentication, not just confidentiality. A tampered ciphertext must throw
   * rather than decrypt to attacker-chosen bytes — those bytes would be sent to
   * Meta as the workspace's access token.
   */
  it("rejects tampered ciphertext", () => {
    const record = encryptToken(token);
    const parts = record.split(":");
    const data = Buffer.from(parts[3]!, "base64");
    data[0] = data[0]! ^ 0xff;

    const tampered = [parts[0], parts[1], parts[2], data.toString("base64")].join(":");
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("rejects a tampered authentication tag", () => {
    const parts = encryptToken(token).split(":");
    const tag = Buffer.from(parts[2]!, "base64");
    tag[0] = tag[0]! ^ 0xff;

    expect(() =>
      decryptToken([parts[0], parts[1], tag.toString("base64"), parts[3]].join(":"))
    ).toThrow();
  });

  it("rejects malformed records", () => {
    expect(() => decryptToken("not-a-record")).toThrow();
    expect(() => decryptToken("v1:only:three")).toThrow();
    expect(() => decryptToken("v2:a:b:c")).toThrow(/Unsupported/);
  });
});

describe("session tokens", () => {
  it("generates distinct high-entropy tokens", () => {
    const tokens = new Set(Array.from({ length: 500 }, generateSessionToken));
    expect(tokens.size).toBe(500);
    // 32 bytes base64url is 43 characters.
    expect(generateSessionToken()).toHaveLength(43);
  });

  it("hashes deterministically and irreversibly", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toContain(token);
    expect(hashSessionToken(token)).toHaveLength(64);
  });
});

describe("safeEqual", () => {
  it("compares equal and unequal values correctly", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("secret", "secrer")).toBe(false);
  });

  it("handles different lengths without throwing", () => {
    // timingSafeEqual throws on a length mismatch, which would itself leak the
    // length. Hashing both sides first makes them fixed-width.
    expect(safeEqual("short", "considerably longer value")).toBe(false);
  });

  it("treats empty strings as equal only to each other", () => {
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("", "x")).toBe(false);
  });
});
