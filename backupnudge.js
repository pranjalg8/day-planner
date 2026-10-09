// Today-tab reminder to back up. Logic lives in backup.js (pure, tested); this is just the DOM.
import { collectData, summarizeData, needsBackup, getLastBackup, getSnoozeUntil, snoozeBackupNudge, daysSince, exportFile } from "./backup.js";

/** Returns a dismissible nudge card, or null when no backup is due. `rerender` is optional. */
export function backupNudge(rerender) {
  let due = false;
  let last = null;
  try {
    last = getLastBackup();
    due = needsBackup({ summary: summarizeData(collectData()), lastBackup: last, snoozeUntil: getSnoozeUntil() });
  } catch { return null; }
  if (!due) return null;
  const d = daysSince(last);
  const card = document.createElement("div");
  card.className = "card bk-nudge";
  card.setAttribute("role", "region");
  card.setAttribute("aria-label", "Backup reminder");
  const msg = document.createElement("p");
  msg.className = "bk-nudge-msg";
  msg.textContent = d == null
    ? "You haven't backed up yet. Your data lives only in this browser."
    : `It's been ${d} days since your last backup.`;
  const row = document.createElement("div");
  row.className = "actions-row";
  const mk = (text, cls, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    if (cls) b.className = cls;
    b.textContent = text;
    b.addEventListener("click", fn);
    return b;
  };
  row.append(
    mk("Back up now", "", () => { exportFile(); card.remove(); rerender?.(); }),
    mk("Remind me later", "secondary", () => { snoozeBackupNudge(); card.remove(); }),
  );
  card.append(msg, row);
  return card;
}
