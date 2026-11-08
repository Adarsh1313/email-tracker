// Pure helpers for scripts/setup.mjs, kept separate so they can be tested.
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";

/** A long random string, URL-safe. */
export function generateSecret() {
  return randomBytes(32).toString("base64url");
}

/**
 * Chrome derives an extension's ID from its public key: the first 128 bits of
 * SHA-256 over the DER bytes, written with the letters a-p instead of 0-f.
 * @param {string} keyBase64 the manifest "key" (base64 DER public key)
 */
export function extensionIdFromKey(keyBase64) {
  const hex = createHash("sha256").update(Buffer.from(keyBase64, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16))).join("");
}

/** A new manifest "key" (base64 DER public key). The private half is discarded: unpacked extensions don't need it. */
export function generateExtensionKey() {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return publicKey.export({ type: "spki", format: "der" }).toString("base64");
}

/** Finds the database id in `wrangler d1 create` output. */
export function parseDatabaseId(output) {
  const m = output.match(/"database_id"\s*:\s*"([0-9a-f-]{36})"/i) ?? output.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
  return m ? m[1] : null;
}

/** Finds the workers.dev host in `wrangler deploy` output (without https://). */
export function parseWorkerHost(output) {
  const m = output.match(/https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev)/i);
  return m ? m[1] : null;
}

/** The wrangler config for this user: the committed one with their database id filled in. */
export function localWranglerConfig(committedJson, databaseId) {
  const config = JSON.parse(committedJson);
  for (const db of config.d1_databases ?? []) db.database_id = databaseId;
  return JSON.stringify(config, null, 2) + "\n";
}
