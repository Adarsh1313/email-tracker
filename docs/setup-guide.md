# Setup guide: from nothing to your first tracked email

Three parts: put the tracker online (Cloudflare), load the extension (Chrome), then send a test email (Gmail).
Type every command in PowerShell (Start menu → "PowerShell"). Paste with right-click.

**Shortcut:** `npm run setup` in the repo root does Parts 1 and 2 for you (it needs a free Cloudflare account). This guide is the manual fallback and explains what each step does.

Personal values never go in committed files. The database ID lives in `worker/wrangler.local.jsonc` (copy `worker/wrangler.jsonc`, replace `REPLACE_WITH_YOUR_D1_ID`), and the Google client ID and extension key live in `extension/local.config.json` (see `local.config.example.json`). Both are git-ignored. First create the database with `npx wrangler d1 create email-tracker` in `worker/` and put its ID in `wrangler.local.jsonc`.

---

## Part 1: Put the tracker online (about 10 minutes)

The tracker is a tiny program on Cloudflare's free plan. It serves the invisible image and remembers when it was loaded.

**1. Go to the worker folder**
```powershell
cd C:\Users\Adarsh\email-tracker\worker
```

**2. Log in to Cloudflare**
```powershell
npx wrangler login
```
A browser tab opens. Click **Allow**. When the tab says you're logged in, close it and return to PowerShell.

**3. Create the tables in the database**
```powershell
npx wrangler d1 migrations apply email-tracker --remote -c wrangler.local.jsonc
```
If it asks "Ok to proceed?", type `y` and press Enter. You should see `0001_init.sql` with a ✅.

**4. Put the tracker online**
```powershell
npm run deploy
```
At the end it prints an address like `https://email-tracker.something.workers.dev`.
**Copy the part without `https://`** (e.g. `email-tracker.something.workers.dev`). That's your **tracker host**. Save it in a note.

**5. Make two passwords (secrets)**
Run this twice. Each run prints a long random string:
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```
- The first string is your **API secret**. Save it in your note: you'll paste it into the extension too.
- The second string is the **IP salt**. You only paste it into Cloudflare once.

**6. Give the secrets to the tracker**
```powershell
npx wrangler secret put API_SECRET -c wrangler.local.jsonc
```
When it asks "Enter a secret value", paste the **API secret** and press Enter. (Nothing shows while you paste; that's normal.)
```powershell
npx wrangler secret put IP_SALT -c wrangler.local.jsonc
```
Paste the **IP salt** and press Enter.

**7. Check it's alive**
Open `https://<your tracker host>/p/test.gif` in a browser. You should get a blank page (a 1×1 invisible image) and no error.

---

## Part 2: Load the extension in Chrome (about 3 minutes)

**1. Build it**
```powershell
cd C:\Users\Adarsh\email-tracker\extension
npm run build
```

**2. Load it**
1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Choose the folder **`C:\Users\Adarsh\email-tracker\extension\dist`**.
   (Pick `dist`, not `extension`. Chrome needs the folder that contains `manifest.json`, and that's `dist`.)
5. Click the puzzle-piece icon in Chrome's toolbar and pin **Email Tracker**.

To keep the same extension ID across rebuilds (needed for Gmail sync), put an `extensionKey` in `extension/local.config.json`; `npm run setup` generates one for you.

**3. Connect it to your tracker**
1. On `chrome://extensions`, click **Details** under Email Tracker → **Extension options**.
2. **Tracker host**: paste your tracker host (no `https://`).
3. **API secret**: paste your API secret.
4. Click **Save**, then **Test tracker**. It should say the tracker is reachable.

**After any code change:** run `npm run build` again, then click the ↻ reload icon on the Email Tracker card in `chrome://extensions`, and refresh Gmail.

---

## Part 3: Gmail smoke test (about 10 minutes)

You need a **second email account** to act as the recipient (another Gmail, or Outlook.com). Open it in a different browser, a Chrome guest window, or on your phone.

1. **Refresh Gmail** (mail.google.com) so the extension loads.
2. Click **Compose**. Next to **Send** you should see a small eye icon (tracking on).
3. Write to your second account, any subject, and click **Send**.
4. Click the **Email Tracker** icon in the toolbar. The dashboard opens and shows the email as **Not opened**.
5. Wait a minute. (Gmail opens count straight away; only other fetchers in the first minute are treated as scanners.)
6. In the **second account**, open the email. (Gmail on the web shows images automatically.)
7. Back in the dashboard, click **Check now**. Within a minute the row should change to **Opened** (✓✓).
8. Extra checks:
   - Open your own copy in **Sent**. It should *not* count as an open.
   - Switch the eye icon off before sending. That email should show as **Untracked**.
   - Press **Ctrl+Enter** to send. It should still be tracked.

If an email shows a "Sent without tracking" message, open the extension options and click **Test tracker** to see what's wrong.

## Part 4: Connect Gmail (replies and bounces)

The extension reads Gmail with read-only access to find replies and bounces. You need your own Google OAuth client, once.

1. Go to https://console.cloud.google.com/ and create a project (any name, e.g. "Email Tracker").
2. **APIs & Services → Library**: search **Gmail API** and click **Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform): choose **External**, fill in the app name and your email, and save. Leave it in **Testing** and add your Gmail address under **Test users**.
4. **Data access / Scopes**: add `https://www.googleapis.com/auth/gmail.readonly`.
5. **Credentials → Create credentials → OAuth client ID**, application type **Chrome extension**. Item ID: your extension ID, shown in the extension's Settings (Gmail sync walkthrough) and on chrome://extensions.
6. Copy the client ID (`….apps.googleusercontent.com`) into `extension/local.config.json` as `oauthClientId`. (The build adds it to the manifest; it is never committed.)
7. Run `npm run build` in `extension`, then click the reload icon on the extension in chrome://extensions.
8. Open the extension's **Settings** and click **Connect Gmail**. Approve the read-only access. Settings should say "Connected as you@gmail.com".

Checks:
- Reply to a tracked email from your second account. Within 5 minutes (or after **Check now**), the row shows **Replied**.
- Send to a made-up address at a real domain (e.g. `nobody-xyz123@gmail.com`). Within 5 minutes the row shows **Bounced**.
- If the dashboard says "Gmail access expired", click **Reconnect Gmail**. Testing-mode Google apps expire access every 7 days.

---

## Trouble?
- **"Manifest file is missing or unreadable"**: you picked `extension` instead of `extension\dist`.
- **`wrangler` asks you to register a workers.dev subdomain**: pick any name. It becomes part of your tracker host.
- **Test tracker fails with 401**: the API secret in the extension doesn't match `API_SECRET`. Run step 6 again and paste the same value in both places.
