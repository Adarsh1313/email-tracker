// Paste into the DevTools console of the dashboard in the NEW Chrome profile,
// after running export-data.js in the old one. Reads the exported JSON from the
// clipboard and merges it in: records the new profile already has are kept, and
// only missing ones are added.
(async () => {
  const data = JSON.parse(await navigator.clipboard.readText());
  if (!Array.isArray(data.emails)) throw new Error("Clipboard doesn't hold an export. Run export-data.js first.");
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("email-tracker");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const count = {};
  for (const name of ["emails", "opens", "overrides"]) {
    const store = db.transaction(name, "readwrite").objectStore(name);
    count[name] = 0;
    for (const item of data[name] ?? []) {
      // add() fails on an existing key, so records already here win.
      await new Promise((resolve) => {
        const req = store.add(item);
        req.onsuccess = () => (count[name]++, resolve());
        req.onerror = (e) => (e.preventDefault(), resolve());
      });
    }
  }
  // Self-views have no natural key, so they're appended.
  const views = db.transaction("selfViews", "readwrite").objectStore("selfViews");
  for (const v of data.selfViews ?? []) views.add({ token: v.token, ts: v.ts });
  count.selfViews = (data.selfViews ?? []).length;
  console.log("Imported:", count, "Reloading…");
  setTimeout(() => location.reload(), 500);
})();
