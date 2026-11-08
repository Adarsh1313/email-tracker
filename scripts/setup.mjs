// One-command setup: npm run setup
// Installs dependencies, logs in to Cloudflare, creates the D1 database, deploys the
// Worker with fresh secrets, makes your own extension key and builds the extension
// with the Worker address and secret pre-filled. Safe to run again: it reuses what
// already exists (your database, secrets and extension key).
//
// Needs a free Cloudflare account: https://dash.cloudflare.com/sign-up
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extensionIdFromKey, generateExtensionKey, generateSecret, localWranglerConfig, parseDatabaseId, parseWorkerHost } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const worker = join(root, "worker");
const extension = join(root, "extension");
const statePath = join(root, ".setup-state.json");
const wranglerLocal = join(worker, "wrangler.local.jsonc");
const extLocal = join(extension, "local.config.json");
const DB_NAME = "email-tracker";

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);
const state = readJson(statePath, {});
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));

function step(text) {
  console.log(`\n→ ${text}`);
}

/** Runs a command; `capture` returns its output (and still shows it). */
function run(cmd, args, { cwd = root, input, capture = false, allowFail = false } = {}) {
  const res = spawnSync(cmd, args, { cwd, shell: true, input, encoding: "utf8", stdio: capture ? ["pipe", "pipe", "pipe"] : input ? ["pipe", "inherit", "inherit"] : "inherit" });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  if (capture && out) process.stdout.write(out);
  if (res.status !== 0 && !allowFail) {
    console.error(`\nCommand failed: ${cmd} ${args.join(" ")}`);
    process.exit(res.status ?? 1);
  }
  return { ok: res.status === 0, out };
}

/** Like run(), but shows output live, keeps stdin attached (so wrangler can ask questions) and returns the output. */
function runInteractive(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: true, stdio: ["inherit", "pipe", "pipe"] });
    let out = "";
    for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.on("data", (chunk) => {
        out += chunk;
        sink.write(chunk);
      });
    }
    child.on("close", (status) => {
      if (status !== 0) {
        console.error(`
Command failed: ${cmd} ${args.join(" ")}`);
        process.exit(status ?? 1);
      }
      resolve(out);
    });
  });
}

console.log("Email Tracker setup. You need a free Cloudflare account (https://dash.cloudflare.com/sign-up).");

step("Installing dependencies");
run("npm", ["install"], { cwd: worker });
run("npm", ["install"], { cwd: extension });

step("Logging in to Cloudflare (a browser tab opens the first time)");
if (!run("npx", ["wrangler", "whoami"], { cwd: worker, capture: true, allowFail: true }).out.match(/associated with the email|You are logged in/i)) {
  run("npx", ["wrangler", "login"], { cwd: worker });
}

step("Creating the database");
if (!state.databaseId) {
  // Run from an empty folder: with a wrangler config next to it, wrangler may offer to write
  // the new database id into the committed worker/wrangler.jsonc.
  const empty = mkdtempSync(join(tmpdir(), "email-tracker-d1-"));
  const wrangler = `node "${join(worker, "node_modules", "wrangler", "bin", "wrangler.js")}"`;
  const created = run(wrangler, ["d1", "create", DB_NAME], { cwd: empty, capture: true, allowFail: true });
  let id = parseDatabaseId(created.out);
  if (!id) {
    // It may already exist from an earlier attempt.
    const list = run(wrangler, ["d1", "list", "--json"], { cwd: empty, capture: true, allowFail: true });
    try {
      id = JSON.parse(list.out.slice(list.out.indexOf("[")))?.find((d) => d.name === DB_NAME)?.uuid ?? null;
    } catch {
      id = null;
    }
  }
  if (!id) {
    console.error("Couldn't create or find the D1 database. Run `npx wrangler d1 create email-tracker` in worker/ and paste the id into worker/wrangler.local.jsonc.");
    process.exit(1);
  }
  state.databaseId = id;
  save();
}
writeFileSync(wranglerLocal, localWranglerConfig(readFileSync(join(worker, "wrangler.jsonc"), "utf8"), state.databaseId));
run("npx", ["wrangler", "d1", "migrations", "apply", DB_NAME, "--remote", "-c", "wrangler.local.jsonc"], { cwd: worker, input: "y\n" });

step("Deploying the Worker");
state.apiSecret ??= generateSecret();
state.ipSalt ??= generateSecret();
save();
// Interactive: on a fresh account wrangler asks you to pick a workers.dev subdomain.
const deployedOut = await runInteractive("npx", ["wrangler", "deploy", "-c", "wrangler.local.jsonc"], worker);
let host = parseWorkerHost(deployedOut) ?? state.trackerHost;
if (!host) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  host = (await rl.question("Couldn't read the workers.dev address. Paste it from the output above (no https://): ")).trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  rl.close();
}
if (!host) {
  console.error("Deployed, but couldn't read the workers.dev address. Copy it from the output above into the extension's Settings.");
  process.exit(1);
}
state.trackerHost = host;
save();
run("npx", ["wrangler", "secret", "put", "API_SECRET", "-c", "wrangler.local.jsonc"], { cwd: worker, input: state.apiSecret });
run("npx", ["wrangler", "secret", "put", "IP_SALT", "-c", "wrangler.local.jsonc"], { cwd: worker, input: state.ipSalt });

step("Making your extension key and building the extension");
const local = readJson(extLocal, {});
local.extensionKey ||= generateExtensionKey();
local.prefill = { trackerHost: state.trackerHost, apiSecret: state.apiSecret };
writeFileSync(extLocal, JSON.stringify(local, null, 2) + "\n");
run("npm", ["run", "build"], { cwd: extension });

console.log(`
Done.

  Worker:        https://${state.trackerHost}
  Extension ID:  ${extensionIdFromKey(local.extensionKey)}

Load the extension:
  1. Open chrome://extensions and turn on Developer mode.
  2. Click Load unpacked and choose:  ${join(extension, "dist")}
  3. Open the extension's Settings: the Worker address and secret are already filled in.
  4. Press "Send a test email" in Settings to check it works end to end.

Optional: Gmail reply and bounce detection. Settings has a walkthrough that shows the extension ID above.
Try it with fake data first:  npm run demo-data
`);
