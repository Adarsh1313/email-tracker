// Bundles the extension into dist/ (load dist/ as an unpacked extension).
//   npm run build   one-off build
//   npm run watch   rebuild on change
//   npm run dev     rebuild on change, and the extension reloads itself (plus open Gmail tabs)
import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, watch as watchFiles, writeFileSync } from "node:fs";

const watch = process.argv.includes("--watch") || process.argv.includes("--dev");
const dev = process.argv.includes("--dev");

function copyStatic() {
  mkdirSync("dist", { recursive: true });
  cpSync("static", "dist", { recursive: true });
  // The design system's tokens are used as is (design/tokens.css is the source of truth).
  cpSync("../design/tokens.css", "dist/tokens.css");
  writeManifest();
}

// Personal values (Google OAuth client ID, extension key) live in the git-ignored
// local.config.json, never in the committed manifest. Without them the extension
// still works; only Gmail reply/bounce sync is off.
function writeManifest() {
  const manifest = JSON.parse(readFileSync("static/manifest.json", "utf8"));
  const local = existsSync("local.config.json") ? JSON.parse(readFileSync("local.config.json", "utf8")) : {};
  if (local.extensionKey) manifest.key = local.extensionKey;
  if (local.oauthClientId) manifest.oauth2.client_id = local.oauthClientId;
  else delete manifest.oauth2;
  writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2));
  // `npm run setup` leaves the Worker address and secret here; the extension reads them once on first load.
  if (local.prefill) writeFileSync("dist/prefill.json", JSON.stringify(local.prefill));
}

copyStatic();
// Fonts are bundled: extension pages must not load remote fonts.
mkdirSync("dist/fonts", { recursive: true });
for (const file of [
  "inter-tight/files/inter-tight-latin-400-normal.woff2",
  "inter-tight/files/inter-tight-latin-500-normal.woff2",
  "inter-tight/files/inter-tight-latin-600-normal.woff2",
  "newsreader/files/newsreader-latin-400-normal.woff2",
  "newsreader/files/newsreader-latin-500-normal.woff2",
]) {
  cpSync(`node_modules/@fontsource/${file}`, `dist/fonts/${file.split("/").pop()}`);
}

// The dev background worker polls this file and reloads the extension when it changes.
function bumpReload() {
  if (dev) writeFileSync("dist/dev-reload.json", JSON.stringify({ id: Date.now() }));
}

const options = {
  entryPoints: {
    background: "src/background.ts",
    gmail: "src/content/gmail.ts",
    settings: "src/pages/settings.ts",
    dashboard: "src/pages/dashboard.ts",
  },
  bundle: true,
  format: "iife", // content scripts cannot be ES modules
  target: "chrome120",
  outdir: "dist",
  sourcemap: "inline",
  logLevel: "info",
  define: { __DEV_RELOAD__: String(dev) },
  plugins: [{ name: "dev-reload", setup: (b) => b.onEnd((r) => r.errors.length === 0 && bumpReload()) }],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  // esbuild only watches code; also pick up HTML, CSS, the manifest and tokens.
  let timer;
  const onStatic = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      copyStatic();
      bumpReload();
      console.log("[watch] static files copied");
    }, 100);
  };
  watchFiles("static", { recursive: true }, onStatic);
  watchFiles("../design/tokens.css", onStatic);
  if (dev) console.log("[dev] Load dist/ once in chrome://extensions; after that it reloads itself on every change.");
} else {
  await esbuild.build(options);
}
