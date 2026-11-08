// The Settings setup checklist: pure, so it can be tested without a browser.

export interface SetupFacts {
  /** Both the Worker host and the API secret are filled in. */
  configured: boolean;
  /** Result of probing the Worker's /api/health. */
  worker: "unknown" | "ok" | "unreachable" | "bad-secret";
  /** A Gmail tab has loaded the extension's content script. */
  gmailTabSeen: boolean;
  gmailSync: "disconnected" | "connected" | "reconnect";
  /** At least one open event has reached the Worker. */
  testOpenSeen: boolean;
}

export type CheckState = "done" | "todo" | "failed";

export interface SetupItem {
  id: "reachable" | "secret" | "gmailTab" | "sync" | "testOpen";
  label: string;
  state: CheckState;
  optional: boolean;
  /** One-line fix, shown while the check isn't done. */
  fix: string | null;
}

function item(id: SetupItem["id"], label: string, state: CheckState, fix: string, optional = false): SetupItem {
  return { id, label, state, optional, fix: state === "done" ? null : fix };
}

export function setupChecklist(f: SetupFacts): SetupItem[] {
  const reachable: CheckState = !f.configured || f.worker === "unknown" ? "todo" : f.worker === "unreachable" ? "failed" : "done";
  const secret: CheckState = f.worker === "ok" ? "done" : f.worker === "bad-secret" ? "failed" : "todo";
  const sync: CheckState = f.gmailSync === "connected" ? "done" : f.gmailSync === "reconnect" ? "failed" : "todo";
  return [
    item("reachable", "Worker reachable", reachable,
      f.configured ? "Check the host is exactly what `npm run deploy` printed, then press Test tracker." : "Enter your Worker host below."),
    item("secret", "API secret matches", secret,
      f.worker === "bad-secret" ? "The secret differs from the Worker's API_SECRET. Paste it again." : "Checked once the Worker is reachable."),
    item("gmailTab", "Gmail tab loaded", f.gmailTabSeen ? "done" : "todo",
      "Open or reload a Gmail tab so the extension can add the pixel."),
    item("sync", "Gmail sync connected", sync,
      f.gmailSync === "reconnect" ? "Access expired. Reconnect Gmail below." : "Connect Gmail below to catch replies and bounces.", true),
    item("testOpen", "First test open seen", f.testOpenSeen ? "done" : "todo",
      "Press Send a test email, send it, then open it from another account or the phone app."),
  ];
}
