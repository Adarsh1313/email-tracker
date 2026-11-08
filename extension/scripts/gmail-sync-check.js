// Paste into the DevTools console of the extension's dashboard page to see how
// Gmail sync is doing. Read-only: it only reads chrome.storage and IndexedDB.
(async () => {
  const { gmail } = await chrome.storage.local.get("gmail");
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("email-tracker");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const emails = await new Promise((resolve) => {
    const req = db.transaction("emails").objectStore("emails").getAll();
    req.onsuccess = () => resolve(req.result);
  });
  const recent = emails.filter((e) => Date.now() - Date.parse(e.sentAt) < 2 * 86_400_000);
  console.log("Gmail state:", gmail?.status ?? "disconnected");
  console.table({
    "emails stored": emails.length,
    "sent in last 2 days": recent.length,
    "matched to a thread (last 2 days)": recent.filter((e) => e.gmailMessageId).length,
    "matched to a thread (all)": emails.filter((e) => e.gmailMessageId).length,
    replied: emails.filter((e) => e.repliedAt).length,
    "replied with client tag": emails.filter((e) => e.replyClient).length,
    bounced: emails.filter((e) => e.bouncedAt).length,
    "still missing To or subject": emails.filter((e) => !e.to.length || !e.subject.trim()).length,
  });
  console.table(
    emails
      .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))
      .slice(0, 10)
      .map((e) => ({
        sent: e.sentAt.slice(0, 16),
        recipients: e.to.length,
        subject: e.subject ? "yes" : "BLANK",
        matched: !!e.gmailMessageId,
        replied: e.repliedAt ? `yes${e.replyClient ? ` (${e.replyClient})` : ""}` : "",
        bounced: e.bouncedAt ? "yes" : "",
      })),
  );
})();
