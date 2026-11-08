// npm run demo-data
// Writes extension/dist/demo-data.json: about 20 fake emails (opens, replies, a bounce)
// that the dashboard imports the next time it opens. Build the extension first.
// Remove them with Settings > Delete all my local data. Every address is on example.com.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "extension", "dist");
if (!existsSync(join(dist, "manifest.json"))) {
  console.error("Build the extension first: npm run setup (or `npm run build` in extension/).");
  process.exit(1);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = Date.now();
let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (list) => list[Math.floor(rand() * list.length)];
const iso = (ms) => new Date(ms).toISOString();

const people = [
  ["Priya Raman", "Orbit Labs", "founder"], ["Marcus Lee", "Northwind Robotics", "hiring_manager"],
  ["Sofia Alvarez", "Lumen Health", "recruiter"], ["Tom Becker", "Fieldnote", "founder"],
  ["Aiko Tanaka", "Kiln Studio", "hiring_manager"], ["Jonas Weber", "Paperplane", "founder"],
  ["Nadia Haddad", "Brightpath", "recruiter"], ["Owen Clarke", "Tidepool", "hiring_manager"],
  ["Ines Costa", "Greenfield AI", "founder"], ["Dev Patel", "Harbor Ledger", "hiring_manager"],
  ["Maya Chen", "Skyline Maps", "recruiter"], ["Luca Rossi", "Copperline", "founder"],
  ["Hannah Berg", "Wavelength", "hiring_manager"], ["Samir Aziz", "Quill", "founder"],
  ["Chloe Dubois", "Nimbus Works", "recruiter"], ["Ravi Menon", "Stackwell", "hiring_manager"],
  ["Elena Petrova", "Daybreak", "founder"], ["Noah Kim", "Fernhill", "hiring_manager"],
  ["Zara Ahmed", "Ledgerly", "recruiter"], ["Pablo Ortiz", "Mosaic Data", "founder"],
];
const variants = ["A", "B"];
const subjects = { founder: "Early engineer for {c}?", hiring_manager: "Frontend role at {c}", recruiter: "Intro: engineer, open to {c}" };

const emails = [];
const opens = [];
let openId = -1;

people.forEach(([name, company, role], i) => {
  const first = name.split(" ")[0].toLowerCase();
  const to = `${first}@${company.toLowerCase().replace(/[^a-z]/g, "")}.example.com`;
  const sentAt = now - (i * 0.9 + rand()) * DAY - rand() * 6 * HOUR;
  const token = `demo-${String(i).padStart(2, "0")}-${Math.floor(rand() * 1e9).toString(36)}`;
  const email = {
    id: token, token, tracked: true, to: [to], subject: subjects[role].replace("{c}", company),
    sentAt: iso(sentAt), company, role, variant: pick(variants), seedTest: false,
  };
  const registered = iso(sentAt + 800);
  const open = (afterMs, extra = {}) =>
    opens.push({
      id: openId--, token, ts: iso(sentAt + afterMs), user_agent: "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)",
      asn: 15169, as_org: "Google LLC", country: pick(["US", "GB", "DE", "IN", "CA"]), ip_hash: `demo${Math.floor(rand() * 1e6)}`,
      registered_at: registered, ...extra,
    });

  // A spread of outcomes, fixed by position so the dashboard shows every status.
  const scenario = i % 10;
  if (scenario === 0 || scenario === 1) {
    open(2 * HOUR + rand() * HOUR);
    if (scenario === 1) open(26 * HOUR);
  } else if (scenario === 2) {
    open(3 * HOUR);
    open(5 * HOUR);
    open(day(1));
    email.repliedAt = iso(sentAt + day(1) + 2 * HOUR);
    email.repliedBy = name;
  } else if (scenario === 3) {
    email.repliedAt = iso(sentAt + 20 * HOUR); // replied, no open recorded
    email.repliedBy = name;
  } else if (scenario === 4) {
    open(4 * MIN); // within 10 minutes of sending: uncertain
  } else if (scenario === 5) {
    open(20_000, { user_agent: "Mozilla/5.0 (X11; Linux x86_64)", asn: 16509, as_org: "Amazon.com, Inc." }); // security scanner
  } else if (scenario === 6) {
    open(8 * HOUR, { user_agent: "Mozilla/5.0 (Macintosh)", asn: 714, as_org: "Apple Inc." }); // Apple Mail privacy preload
  } else if (scenario === 7 && i === 7) {
    email.bouncedAt = iso(sentAt + 3 * MIN);
  } else if (scenario === 8) {
    open(6 * HOUR);
    open(48 * HOUR);
  }
  // scenarios 7 (others) and 9: sent, not opened.
  emails.push(email);
});

function day(n) {
  return n * DAY;
}

mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, "demo-data.json"), JSON.stringify({ id: `demo-${now}`, emails, opens }));
console.log(`Wrote ${emails.length} fake emails and ${opens.length} opens to extension/dist/demo-data.json.`);
console.log("Open the extension's dashboard to see them. Remove them with Settings > Delete all my local data.");
