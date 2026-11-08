// Paste into the DevTools console of the dashboard in the OLD Chrome profile.
// Copies every local record (emails, opens, self-views, "That was me" overrides)
// to the clipboard as JSON. Read-only. Settings and the API secret are not included.
(async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("email-tracker");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const all = (name) =>
    db.objectStoreNames.contains(name)
      ? new Promise((resolve) => {
          const req = db.transaction(name).objectStore(name).getAll();
          req.onsuccess = () => resolve(req.result);
        })
      : [];
  const data = {
    exportedAt: new Date().toISOString(),
    emails: await all("emails"),
    opens: await all("opens"),
    selfViews: await all("selfViews"),
    overrides: await all("overrides"),
  };
  copy(JSON.stringify(data));
  console.log(`Copied ${data.emails.length} emails, ${data.opens.length} opens, ${data.selfViews.length} self-views. Now run import-data.js in the new profile.`);
})();
