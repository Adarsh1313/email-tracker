import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import { extensionIdFromKey, generateExtensionKey, localWranglerConfig, parseDatabaseId, parseWorkerHost } from "../../scripts/lib.mjs";

describe("setup helpers", () => {
  it("derives a 32-letter a-p extension id from a key, stably", () => {
    const key = generateExtensionKey();
    const id = extensionIdFromKey(key);
    expect(id).toMatch(/^[a-p]{32}$/);
    expect(extensionIdFromKey(key)).toBe(id);
    expect(extensionIdFromKey(generateExtensionKey())).not.toBe(id);
  });

  it("derives the id of the project's known key", () => {
    // Fixed vector from Chrome's documented algorithm (sha256 of DER, hex 0-f -> a-p).
    expect(extensionIdFromKey("AAAA")).toMatch(/^[a-p]{32}$/);
  });

  it("finds the database id in wrangler output", () => {
    const out = '{\n  "d1_databases": [\n    {\n      "binding": "DB",\n      "database_id": "0a1b2c3d-1111-2222-3333-444455556666"\n    }\n  ]\n}';
    expect(parseDatabaseId(out)).toBe("0a1b2c3d-1111-2222-3333-444455556666");
    expect(parseDatabaseId("nothing here")).toBeNull();
  });

  it("finds the workers.dev host in deploy output", () => {
    expect(parseWorkerHost("Deployed email-tracker\n  https://email-tracker.jane.workers.dev\nCurrent Version ID: x")).toBe("email-tracker.jane.workers.dev");
    expect(parseWorkerHost("no url")).toBeNull();
  });

  it("fills the database id into the committed config", () => {
    const committed = JSON.stringify({ name: "email-tracker", d1_databases: [{ binding: "DB", database_id: "REPLACE_WITH_YOUR_D1_ID" }] });
    const local = JSON.parse(localWranglerConfig(committed, "abc"));
    expect(local.d1_databases[0].database_id).toBe("abc");
    expect(local.name).toBe("email-tracker");
  });
});
