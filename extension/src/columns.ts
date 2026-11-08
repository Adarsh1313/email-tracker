// Which optional Emails-table columns are shown, kept in chrome.storage.local.
// Separate from Settings so the Settings form never overwrites them.

export interface ColumnPrefs {
  company: boolean;
  subject: boolean;
  firstOpen: boolean;
  lastActivity: boolean;
}

export const DEFAULT_COLUMNS: ColumnPrefs = { company: true, subject: true, firstOpen: true, lastActivity: true };

export async function getColumns(): Promise<ColumnPrefs> {
  const stored = await chrome.storage.local.get("columns");
  return { ...DEFAULT_COLUMNS, ...((stored.columns as Partial<ColumnPrefs> | undefined) ?? {}) };
}

export async function saveColumns(prefs: ColumnPrefs): Promise<void> {
  await chrome.storage.local.set({ columns: prefs });
}
