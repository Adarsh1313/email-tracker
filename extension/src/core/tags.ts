import type { RoleType } from "./types";

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "yahoo.co.in",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "zoho.com", "gmx.com", "yandex.com",
  "rediffmail.com", "hey.com", "fastmail.com",
]);

// Second-level labels used under country TLDs (acme.co.uk → "acme").
const SECOND_LEVEL = new Set(["co", "com", "ac", "org", "net", "gov", "edu"]);

function domainOf(address: string): string {
  return address.trim().toLowerCase().split("@").pop() ?? "";
}

function companyFromDomain(domain: string): string {
  if (!domain || FREE_MAIL.has(domain)) return "";
  const parts = domain.split(".");
  let i = parts.length - 2;
  if (i > 0 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[i])) i--;
  const label = parts[Math.max(0, i)];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function normaliseSubject(subject: string): string {
  return subject
    .replace(/^(\s*(re|fwd?|aw|wg)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function prefillTags(to: string[], subject: string): { company: string; role: RoleType; variant: string } {
  return { company: companyFromDomain(domainOf(to[0] ?? "")), role: "", variant: normaliseSubject(subject) };
}

// Entries: "mom@gmail.com" (address), "family.org" or "@family.org" (domain and
// its subdomains), "*.de" (any address under a TLD).
function matchesEntry(address: string, entry: string): boolean {
  const e = entry.trim().toLowerCase();
  if (!e) return false;
  const addr = address.trim().toLowerCase();
  if (e.includes("@") && !e.startsWith("@")) return addr === e;
  const domain = domainOf(addr);
  const suffix = e.replace(/^\*?\.?@?/, "");
  return domain === suffix || domain.endsWith(`.${suffix}`);
}

export function isNeverTrack(to: string[], neverTrack: string[]): boolean {
  return to.some((address) => neverTrack.some((entry) => matchesEntry(address, entry)));
}

export function isSeedSend(to: string[], seeds: string[]): boolean {
  const set = new Set(seeds.map((s) => s.trim().toLowerCase()));
  return to.length > 0 && to.every((a) => set.has(a.trim().toLowerCase()));
}
