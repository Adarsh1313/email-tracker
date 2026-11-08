import { describe, expect, it } from "vitest";
import { classifyOpen, DEFAULT_RULES } from "../../src/core/classify";
import type { OpenEvent } from "../../src/core/types";

const SENT_AT = "2026-10-28T10:00:00.000Z";
const GMAIL_PROXY_UA = "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)";
const APPLE_UA = "Mozilla/5.0";
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

function at(minutesAfterSend: number): string {
  return new Date(Date.parse(SENT_AT) + minutesAfterSend * 60_000).toISOString();
}

function event(over: Partial<OpenEvent>): OpenEvent {
  return {
    id: 1,
    token: "tok1234567890123456789",
    ts: at(30),
    user_agent: GMAIL_PROXY_UA,
    asn: 15169,
    as_org: "Google LLC",
    country: "US",
    ip_hash: "h",
    ...over,
  };
}

const email = { token: "tok1234567890123456789", sentAt: SENT_AT };

describe("classifyOpen", () => {
  it("counts a Gmail image-proxy fetch as a human open", () => {
    expect(classifyOpen(event({}), email, [])).toBe("human");
  });

  it("marks a Gmail proxy fetch in the first 10 minutes as uncertain (could be my phone)", () => {
    expect(classifyOpen(event({ ts: at(0.5) }), email, [])).toBe("uncertain");
    expect(classifyOpen(event({ ts: at(9) }), email, [])).toBe("uncertain");
    expect(classifyOpen(event({ ts: at(11) }), email, [])).toBe("human");
  });

  it("treats a non-Gmail fetch in the first minute after sending as automated (scanners)", () => {
    const e = event({ ts: at(0.5), asn: 24560, as_org: "Bharti Airtel Ltd.", user_agent: CHROME_UA });
    expect(classifyOpen(e, email, [])).toBe("automated");
  });

  it("treats a Gmail proxy fetch right after sending as self when I viewed my sent copy", () => {
    const selfViews = [{ token: email.token, ts: at(0.2) }];
    expect(classifyOpen(event({ ts: at(0.5) }), email, selfViews)).toBe("self");
  });

  it("treats an open within 90 s of me viewing my own sent copy as self", () => {
    const selfViews = [{ token: email.token, ts: at(44.5) }];
    expect(classifyOpen(event({ ts: at(45) }), email, selfViews)).toBe("self");
    expect(classifyOpen(event({ ts: at(50) }), email, selfViews)).toBe("human");
  });

  it("ignores self-views of other emails", () => {
    const selfViews = [{ token: "otherToken000000000000", ts: at(45) }];
    expect(classifyOpen(event({ ts: at(45) }), email, selfViews)).toBe("human");
  });

  it.each([
    [16509, "Amazon.com, Inc."],
    [26211, "Proofpoint, Inc."],
    [30031, "Mimecast Ltd"],
    [15324, "Barracuda Networks"],
  ])("treats security-scanner and data-centre networks (AS%i %s) as automated", (asn, org) => {
    expect(classifyOpen(event({ asn, as_org: org, user_agent: CHROME_UA }), email, [])).toBe("automated");
  });

  it("matches scanner networks by organisation name when the ASN is unknown", () => {
    expect(classifyOpen(event({ asn: 1, as_org: "PROOFPOINT-ASN-EU", user_agent: CHROME_UA }), email, [])).toBe(
      "automated",
    );
  });

  it("treats Apple Mail Privacy Protection fetches as uncertain", () => {
    expect(classifyOpen(event({ asn: 714, as_org: "Apple Inc.", user_agent: APPLE_UA }), email, [])).toBe(
      "uncertain",
    );
  });

  it("counts a normal browser on a residential network as human", () => {
    expect(classifyOpen(event({ asn: 24560, as_org: "Bharti Airtel Ltd.", user_agent: CHROME_UA }), email, [])).toBe(
      "human",
    );
  });

  it("measures windows from the Worker's registration time, not the laptop clock", () => {
    // Laptop clock 10 minutes fast: its sentAt is later than the real send.
    const skewed = { ...email, sentAt: at(20) };
    const e = event({ ts: at(15), registered_at: at(0) });
    expect(classifyOpen(e, skewed, [])).toBe("human");
  });

  it("lets custom rules change the windows", () => {
    const rules = { ...DEFAULT_RULES, scannerWindowMs: 0 };
    const e = event({ ts: at(0.5), asn: 24560, as_org: "Bharti Airtel Ltd.", user_agent: CHROME_UA });
    expect(classifyOpen(e, email, [], rules)).toBe("human");
  });
});
