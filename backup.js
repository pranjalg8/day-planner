// Export / import of all planner data (localStorage keys prefixed "elevate-planner:").
const PREFIX = "elevate-planner:";
const FORMAT = "elevate-planner-backup";
// UI bookkeeping keys: deliberately NOT prefixed, so they are never exported or restored.
export const LAST_BACKUP_KEY = "day-planner-ui:lastBackup";
export const SNOOZE_KEY = "day-planner-ui:backupSnoozeUntil";
export const SNAPSHOT_KEY = "day-planner-ui:preImportSnapshot";
export const BACKUP_INTERVAL_DAYS = 7;
export const SNOOZE_DAYS = 2;
export const MIN_DAYS_TO_NUDGE = 3;
const DAY_MS = 86400000;
const DAY_RE = /^elevate-planner:(\d{4}-\d{2}-\d{2})$/;

export function collectData() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) data[k] = localStorage.getItem(k);
  }
  return data;
}

export function validateBackup(obj) {
  if (!obj || typeof obj !== "object" || obj.format !== FORMAT || obj.version !== 1) throw new Error("Not a Day Planner backup file.");
  if (!obj.data || typeof obj.data !== "object" || Array.isArray(obj.data)) throw new Error("Backup has no data.");
  for (const [k, v] of Object.entries(obj.data)) {
    if (!k.startsWith(PREFIX)) throw new Error(`Unexpected key: ${k}`);
    if (typeof v !== "string") throw new Error(`Bad value for ${k}`);
    try { JSON.parse(v); } catch { throw new Error(`Corrupt value for ${k}`); }
  }
  return obj.data;
}

export function restoreData(data) {
  for (const k of Object.keys(collectData())) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
}

function parseObj(raw) {
  try { const v = JSON.parse(raw); return v && typeof v === "object" ? v : null; } catch { return null; }
}

/** Pure: counts what a data blob (as from collectData) holds. */
export function summarizeData(data) {
  const out = { days: 0, weighIns: 0, logDays: 0, hasPlan: false, keys: 0 };
  if (!data || typeof data !== "object") return out;
  out.keys = Object.keys(data).length;
  for (const [k, v] of Object.entries(data)) {
    if (DAY_RE.test(k)) out.days++;
    else if (k === PREFIX + "log") {
      const log = parseObj(v) || {};
      for (const day of Object.values(log)) {
        if (!day || typeof day !== "object") continue;
        out.logDays++;
        if (day.weight != null) out.weighIns++;
      }
    } else if (k === PREFIX + "plan") out.hasPlan = true;
  }
  return out;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Pure: one-line human description of a summary. */
export function describeSummary(s) {
  const parts = [plural(s.days, "day") + " of checklists"];
  if (s.weighIns) parts.push(plural(s.weighIns, "weigh-in"));
  if (s.logDays) parts.push(plural(s.logDays, "log day"));
  if (s.hasPlan) parts.push("your program settings");
  return parts.join(", ");
}

/** Pure: whole days between an ISO timestamp and `now` (null if unknown/invalid). */
export function daysSince(iso, now = new Date()) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

/** Pure: "Never backed up" / "Last backed up: 3 days ago (Oct 6, 2026)". */
export function lastBackupLabel(iso, now = new Date()) {
  const d = daysSince(iso, now);
  if (d == null) return "Never backed up";
  const when = d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
  const date = new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return `Last backed up: ${when} (${date})`;
}

/** Pure: should the Today tab nudge? Needs enough data, an old/missing backup, and no active snooze. */
export function needsBackup({ summary, lastBackup, snoozeUntil, now = new Date() }) {
  if (!summary || Math.max(summary.days, summary.logDays) < MIN_DAYS_TO_NUDGE) return false;
  const snooze = Date.parse(snoozeUntil || "");
  if (!Number.isNaN(snooze) && snooze > now.getTime()) return false;
  const d = daysSince(lastBackup, now);
  return d == null || d >= BACKUP_INTERVAL_DAYS;
}

function uiGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function uiSet(key, v) { try { localStorage.setItem(key, v); return true; } catch { return false; } }
function uiDel(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } }

export const getLastBackup = () => uiGet(LAST_BACKUP_KEY);
export const markBackedUp = (now = new Date()) => uiSet(LAST_BACKUP_KEY, now.toISOString());
export const getSnoozeUntil = () => uiGet(SNOOZE_KEY);
export function snoozeBackupNudge(now = new Date()) { uiSet(SNOOZE_KEY, new Date(now.getTime() + SNOOZE_DAYS * DAY_MS).toISOString()); }

/** Saves the current data as the single safety copy. Returns false if storage refused it. */
export function saveSnapshot(now = new Date()) {
  return uiSet(SNAPSHOT_KEY, JSON.stringify({ savedAt: now.toISOString(), data: collectData() }));
}

/** The pending safety copy as { savedAt, data }, or null. */
export function readSnapshot() {
  const o = parseObj(uiGet(SNAPSHOT_KEY));
  if (!o || !o.data || typeof o.data !== "object") return null;
  try { validateBackup({ format: FORMAT, version: 1, data: o.data }); } catch { return null; }
  return o;
}

/** Restores the safety copy and discards it. Returns true if something was restored. */
export function undoImport() {
  const snap = readSnapshot();
  if (!snap) return false;
  restoreData(snap.data);
  uiDel(SNAPSHOT_KEY);
  return true;
}

/** Pure: parse backup file text into { data, exportedAt }; throws a friendly Error. */
export function parseBackupText(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error("That file is not valid JSON."); }
  const data = validateBackup(obj);
  return { data, exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : null };
}

/** Builds and downloads the backup file; records the time. Export of the data itself is unchanged (format v1). */
export function exportFile() {
  const payload = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), data: collectData() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `day-planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  markBackedUp();
}

/** Accessible confirm sheet. Resolves "replace" or "cancel". */
function confirmImport({ exportedAt, incoming, current }) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "ob-overlay bk-overlay";
    const dlg = document.createElement("div");
    dlg.className = "ob-dialog bk-dialog";
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    dlg.setAttribute("aria-labelledby", "bk-title");
    dlg.setAttribute("aria-describedby", "bk-desc");
    const h = document.createElement("h2");
    h.id = "bk-title";
    h.textContent = "Replace your data with this backup?";
    const desc = document.createElement("div");
    desc.id = "bk-desc";
    const when = exportedAt && !Number.isNaN(Date.parse(exportedAt)) ? new Date(exportedAt).toLocaleString() : "an unknown date";
    const p1 = document.createElement("p");
    p1.textContent = `This backup is from ${when} and contains ${describeSummary(incoming)}.`;
    const p2 = document.createElement("p");
    p2.textContent = `Your current data has ${describeSummary(current)}.`;
    const p3 = document.createElement("p");
    p3.className = "bk-warn";
    p3.textContent = "Importing REPLACES your current data. A safety copy is kept so you can undo.";
    desc.append(p1, p2, p3);
    const note = document.createElement("div");
    note.className = "muted";
    note.setAttribute("role", "status");
    const actions = document.createElement("div");
    actions.className = "ob-actions bk-actions";
    const mk = (text, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = text;
      b.addEventListener("click", fn);
      return b;
    };
    const finish = (r) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      document.body.classList.remove("ob-open");
      try { opener?.focus?.(); } catch { /* ignore */ }
      resolve(r);
    };
    const cancel = mk("Cancel", "secondary", () => finish("cancel"));
    const dl = mk("Download my current data first", "secondary", () => { exportFile(); note.textContent = "Downloaded your current data."; });
    const go = mk("Replace my data", "", () => finish("replace"));
    actions.append(cancel, dl, go);
    dlg.append(h, desc, note, actions);
    overlay.appendChild(dlg);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) finish("cancel"); });
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish("cancel"); return; }
      if (e.key !== "Tab") return;
      const f = [...dlg.querySelectorAll("button")];
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!dlg.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey, true);
    document.body.classList.add("ob-open");
    document.body.appendChild(overlay);
    cancel.focus();
  });
}

/** Builds the Backup card. `onRestored` is called after a successful import or undo (re-render). */
export function backupCard(onRestored) {
  const status = document.createElement("div");
  status.className = "muted";
  status.setAttribute("role", "status");
  status.id = "backup-status";

  const last = document.createElement("p");
  last.className = "bk-last";
  const sum = document.createElement("p");
  sum.className = "muted bk-summary";
  const undoRow = document.createElement("div");
  undoRow.className = "actions-row bk-undo";
  const refresh = () => {
    last.textContent = lastBackupLabel(getLastBackup());
    sum.textContent = `Would be backed up: ${describeSummary(summarizeData(collectData()))}.`;
    undoRow.replaceChildren();
    const snap = readSnapshot();
    if (snap) {
      const b = mk("Undo last import", async () => {
        if (undoImport()) { status.textContent = "Import undone. Your previous data is back."; refresh(); onRestored?.(); document.getElementById("backup-status")?.replaceChildren("Import undone. Your previous data is back."); }
      });
      const s = document.createElement("span");
      s.className = "muted";
      s.textContent = `Safety copy from ${new Date(snap.savedAt).toLocaleString()}.`;
      undoRow.append(b, s);
    }
    undoRow.hidden = !snap;
  };

  const file = document.createElement("input");
  file.type = "file";
  file.accept = "application/json,.json";
  file.hidden = true;
  file.setAttribute("aria-label", "Choose backup file to import");
  file.addEventListener("change", async () => {
    const f = file.files[0];
    file.value = "";
    if (!f) return;
    try {
      const { data, exportedAt } = parseBackupText(await f.text());
      const choice = await confirmImport({ exportedAt, incoming: summarizeData(data), current: summarizeData(collectData()) });
      if (choice !== "replace") { status.textContent = "Import cancelled. Nothing changed."; return; }
      if (!saveSnapshot()) { status.textContent = "Import stopped: couldn't save a safety copy of your current data (storage full?). Nothing changed."; return; }
      restoreData(data);
      const msg = `Imported ${describeSummary(summarizeData(data))}. You can undo this below.`;
      status.textContent = msg;
      refresh();
      onRestored?.();
      document.getElementById("backup-status")?.replaceChildren(msg);
    } catch (err) {
      status.textContent = `Import failed: ${err.message}`;
    }
  });

  function mk(text, fn) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "secondary";
    b.textContent = text;
    b.addEventListener("click", fn);
    return b;
  }
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h2");
  h.textContent = "Backup";
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = "Your edited times and checked-off items live only in this browser. Export them to a file, or restore from one (import replaces current data, after a preview).";
  const row = document.createElement("div");
  row.className = "actions-row";
  row.append(mk("Export data", () => { exportFile(); status.textContent = "Backup downloaded."; refresh(); }), mk("Import data", () => file.click()), file);
  refresh();
  card.append(h, last, sum, p, row, undoRow, status);
  return card;
}
