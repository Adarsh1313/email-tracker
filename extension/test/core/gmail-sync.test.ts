import { describe, expect, it } from "vitest";
import {
  backfillFrom,
  detectReply,
  matchBounce,
  matchThread,
  messageText,
  replyClient,
  type GmailMessage,
} from "../../src/core/gmail-sync";
import type { TrackedEmail } from "../../src/core/types";

const ME = "adarsh@example.com";
const SENT_AT = "2026-10-28T10:00:00.000Z";
const TOKEN = "tok1234567890123456789";

function b64url(s: string): string {
  let bin = "";
  for (const byte of new TextEncoder().encode(s)) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function minutes(m: number): string {
  return String(Date.parse(SENT_AT) + m * 60_000);
}

// Shaped like users.messages.get?format=full: multipart/alternative with base64url parts.
function message(over: {
  id?: string;
  threadId?: string;
  at?: number;
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  extraHeaders?: { name: string; value: string }[];
}): GmailMessage {
  const headers = [
    { name: "From", value: over.from ?? `Adarsh <${ME}>` },
    { name: "To", value: over.to ?? "Priya Shah <priya@acme.io>" },
    { name: "Subject", value: over.subject ?? "Quick question about the PM role" },
    ...(over.extraHeaders ?? []),
  ];
  const parts = [
    { mimeType: "text/plain", body: { size: 1, data: b64url(over.text ?? "Hi Priya,\r\nShort note.\r\n") } },
    ...(over.html ? [{ mimeType: "text/html", body: { size: 1, data: b64url(over.html) } }] : []),
  ];
  return {
    id: over.id ?? "m1",
    threadId: over.threadId ?? "t1",
    internalDate: minutes(over.at ?? 0),
    payload: { mimeType: "multipart/alternative", headers, body: { size: 0 }, parts },
  };
}

function email(over: Partial<TrackedEmail> = {}): TrackedEmail {
  return {
    id: TOKEN,
    token: TOKEN,
    tracked: true,
    to: ["priya@acme.io"],
    subject: "Quick question about the PM role",
    sentAt: SENT_AT,
    company: "Acme",
    role: "",
    variant: "Quick question about the PM role",
    seedTest: false,
    ...over,
  };
}

describe("messageText", () => {
  it("decodes base64url text parts and strips HTML", () => {
    const m = message({ text: "Plain bit", html: "<div>Sent via <b>Superhuman</b></div>" });
    expect(messageText(m)).toContain("Plain bit");
    expect(messageText(m)).toContain("Sent via Superhuman");
  });

  it("reads a single-part body", () => {
    const m: GmailMessage = {
      id: "x",
      threadId: "t",
      internalDate: minutes(0),
      payload: { mimeType: "text/plain", headers: [], body: { size: 3, data: b64url("héllo") } },
    };
    expect(messageText(m)).toBe("héllo");
  });
});

describe("matchThread", () => {
  it("matches the sent message by recipient, subject and time", () => {
    const sent = [
      message({ id: "other", threadId: "t0", to: "ops@acme.io", at: 0.2 }),
      message({ id: "m1", threadId: "t1", at: 0.3 }),
    ];
    expect(matchThread(email(), sent, new Set())?.id).toBe("m1");
  });

  it("ignores Re:/Fwd: prefixes and case in subjects", () => {
    const sent = [message({ subject: "RE: quick question about the PM role", at: 0.1 })];
    expect(matchThread(email(), sent, new Set())?.id).toBe("m1");
  });

  it("rejects messages sent too far from the recorded send time", () => {
    expect(matchThread(email(), [message({ at: 30 })], new Set())).toBeNull();
  });

  it("skips messages already matched to another email", () => {
    expect(matchThread(email(), [message({ id: "m1" })], new Set(["m1"]))).toBeNull();
  });

  it("matches a record with blank To/subject by time, preferring the message carrying our pixel", () => {
    const blank = email({ to: [], subject: "" });
    const sent = [
      message({ id: "near", at: 0.1 }),
      message({ id: "ours", at: 0.6, html: `<p>Hi</p><img src="https://t.workers.dev/p/${TOKEN}.gif">` }),
    ];
    expect(matchThread(blank, sent, new Set())?.id).toBe("ours");
  });

  it("falls back to the nearest send in a short window when no pixel is found", () => {
    const blank = email({ to: [], subject: "", token: null, tracked: false });
    const sent = [message({ id: "far", at: 4 }), message({ id: "near", at: 0.5 }), message({ id: "out", at: 9 })];
    expect(matchThread(blank, sent, new Set())?.id).toBe("near");
  });
});

describe("backfillFrom", () => {
  it("fills a missing To and subject from the matched sent message", () => {
    const m = message({ to: "Priya Shah <priya@acme.io>, ops@acme.io", subject: "Hello" });
    expect(backfillFrom(email({ to: [], subject: "" }), m)).toEqual({
      to: ["priya@acme.io", "ops@acme.io"],
      subject: "Hello",
    });
  });

  it("leaves fields that are already set", () => {
    expect(backfillFrom(email(), message({ subject: "Different" }))).toEqual({});
  });
});

describe("detectReply", () => {
  const sentMsg = message({ id: "m1", at: 0 });

  it("finds the first later message from someone else", () => {
    const thread = [
      sentMsg,
      message({ id: "r1", at: 90, from: "Priya Shah <priya@acme.io>", text: "Thanks, let's talk." }),
      message({ id: "r2", at: 120, from: "Priya Shah <priya@acme.io>" }),
    ];
    expect(detectReply(thread, "m1", ME)).toEqual({
      at: new Date(Date.parse(SENT_AT) + 90 * 60_000).toISOString(),
      client: null,
      from: "Priya Shah",
    });
  });

  it("names the replier by address when the From header has no display name", () => {
    const thread = [sentMsg, message({ id: "r1", at: 5, from: "priya@acme.io" })];
    expect(detectReply(thread, "m1", ME)?.from).toBe("priya@acme.io");
  });

  it("ignores my own follow-ups and bounce notices", () => {
    const thread = [
      sentMsg,
      message({ id: "f1", at: 60, from: `Adarsh <${ME.toUpperCase()}>` }),
      message({ id: "b1", at: 61, from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" }),
    ];
    expect(detectReply(thread, "m1", ME)).toBeNull();
  });

  it("ignores messages before the matched send", () => {
    const thread = [message({ id: "old", at: -60, from: "priya@acme.io" }), sentMsg];
    expect(detectReply(thread, "m1", ME)).toBeNull();
  });

  it("tags a reply sent from Superhuman", () => {
    const thread = [
      sentMsg,
      message({ id: "r1", at: 5, from: "priya@acme.io", html: "<p>Sure!</p><div>Sent via <a href=\"https://sprh.mn\">Superhuman</a></div>" }),
    ];
    expect(detectReply(thread, "m1", ME)?.client).toBe("Superhuman");
  });
});

describe("replyClient", () => {
  it("only reads the reply's own text, not a quoted earlier message", () => {
    expect(replyClient("Thanks!\n\nOn Tue, Priya wrote:\n> Sent via Superhuman")).toBeNull();
    expect(replyClient("Thanks!\n--\nSent via Superhuman iOS")).toBe("Superhuman");
  });
});

describe("matchBounce", () => {
  const bounce = (text: string, extra: { name: string; value: string }[] = [], at = 2) =>
    message({
      id: "b1",
      at,
      from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      subject: "Delivery Status Notification (Failure)",
      text,
      extraHeaders: extra,
    });

  it("matches by X-Failed-Recipients", () => {
    const b = bounce("Address not found", [{ name: "X-Failed-Recipients", value: "priya@acme.io" }]);
    expect(matchBounce(b, [email(), email({ id: "e2", to: ["raj@beta.io"] })])).toEqual([TOKEN]);
  });

  it("matches an address mentioned in the bounce text", () => {
    const b = bounce("Your message wasn't delivered to Priya@Acme.io because the address couldn't be found.");
    expect(matchBounce(b, [email()])).toEqual([TOKEN]);
  });

  it("ignores emails sent after the bounce or already bounced", () => {
    const b = bounce("not delivered to priya@acme.io", [], -5);
    expect(matchBounce(b, [email()])).toEqual([]);
    expect(matchBounce(bounce("priya@acme.io"), [email({ bouncedAt: SENT_AT })])).toEqual([]);
  });

  it("picks only the latest send to that address", () => {
    const earlier = email({ id: "e0", sentAt: "2026-10-27T10:00:00.000Z" });
    expect(matchBounce(bounce("priya@acme.io"), [earlier, email()])).toEqual([TOKEN]);
  });
});
