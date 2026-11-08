import { describe, expect, it } from "vitest";
import { newToken, pixelUrl, trackerTokenFromSrc } from "../../src/core/pixel";

const HOST = "email-tracker.me.workers.dev";

describe("pixel urls", () => {
  it("builds the pixel url for a token", () => {
    expect(pixelUrl(HOST, "abcDEF_-0123456789abcd")).toBe(
      "https://email-tracker.me.workers.dev/p/abcDEF_-0123456789abcd.gif",
    );
  });

  it("generates 22-char URL-safe tokens that don't repeat", () => {
    const tokens = new Set(Array.from({ length: 200 }, newToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("trackerTokenFromSrc", () => {
  it("reads the token from a direct pixel url", () => {
    expect(trackerTokenFromSrc(`https://${HOST}/p/tok1234567890123456789.gif`, HOST)).toBe("tok1234567890123456789");
  });

  it("reads the token from a Gmail image-proxy url that keeps the original after #", () => {
    const src = `https://ci3.googleusercontent.com/meips/ADKq_NZ3abc=s0-d-e1-ft#https://${HOST}/p/tok1234567890123456789.gif`;
    expect(trackerTokenFromSrc(src, HOST)).toBe("tok1234567890123456789");
  });

  it("ignores other images and other hosts", () => {
    expect(trackerTokenFromSrc("https://example.com/p/tok1234567890123456789.gif", HOST)).toBeNull();
    expect(trackerTokenFromSrc(`https://${HOST}/logo.png`, HOST)).toBeNull();
    expect(trackerTokenFromSrc("", HOST)).toBeNull();
  });
});
