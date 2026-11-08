import { describe, expect, it } from "vitest";
import { isNeverTrack, isSeedSend, prefillTags } from "../../src/core/tags";

describe("prefillTags", () => {
  it("guesses company from the recipient's domain", () => {
    expect(prefillTags(["priya@acme.io"], "Hi").company).toBe("Acme");
    expect(prefillTags(["jo@mail.stripe.com"], "Hi").company).toBe("Stripe");
    expect(prefillTags(["sam@monzo.co.uk"], "Hi").company).toBe("Monzo");
  });

  it("leaves company blank for free-mail addresses", () => {
    expect(prefillTags(["someone@gmail.com"], "Hi").company).toBe("");
    expect(prefillTags(["someone@outlook.com"], "Hi").company).toBe("");
  });

  it("uses the subject as the variant, without Re:/Fwd: prefixes or extra spaces", () => {
    expect(prefillTags(["a@acme.io"], "Re: RE: Fwd:  Quick   question ").variant).toBe("Quick question");
  });

  it("starts with no role", () => {
    expect(prefillTags(["a@acme.io"], "Hi").role).toBe("");
  });
});

describe("isNeverTrack", () => {
  const list = ["family.org", "mom@gmail.com", "@iitb.ac.in", "*.de"];

  it("matches whole domains, subdomains, exact addresses and wildcard TLDs", () => {
    expect(isNeverTrack(["aunt@family.org"], list)).toBe(true);
    expect(isNeverTrack(["prof@cse.iitb.ac.in"], list)).toBe(true);
    expect(isNeverTrack(["Mom@Gmail.com"], list)).toBe(true);
    expect(isNeverTrack(["hr@firma.de"], list)).toBe(true);
  });

  it("is true when any recipient matches", () => {
    expect(isNeverTrack(["founder@acme.io", "aunt@family.org"], list)).toBe(true);
  });

  it("doesn't match lookalikes", () => {
    expect(isNeverTrack(["dad@gmail.com"], list)).toBe(false);
    expect(isNeverTrack(["x@notfamily.org"], list)).toBe(false);
    expect(isNeverTrack(["x@decathlon.com"], list)).toBe(false);
  });
});

describe("isSeedSend", () => {
  const seeds = ["me.seed@gmail.com", "me.seed@outlook.com"];

  it("is true only when every recipient is a seed address", () => {
    expect(isSeedSend(["ME.seed@gmail.com", "me.seed@outlook.com"], seeds)).toBe(true);
    expect(isSeedSend(["me.seed@gmail.com", "founder@acme.io"], seeds)).toBe(false);
    expect(isSeedSend([], seeds)).toBe(false);
  });
});
