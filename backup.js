// Export / import of all planner data (localStorage keys prefixed "elevate-planner:").
const PREFIX = "elevate-planner:";
const FORMAT = "elevate-planner-backup";

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

function exportFile() {
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
}

/** Builds the Backup card. `onRestored` is called after a successful import (re-render). */
export function backupCard(onRestored) {
  const status = document.createElement("div");
  status.className = "muted";
  status.setAttribute("role", "status");
  status.id = "backup-status";

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
      const data = validateBackup(JSON.parse(await f.text()));
      restoreData(data);
      status.textContent = `Imported ${Object.keys(data).length} day record(s).`;
      onRestored?.();
      document.getElementById("backup-status")?.replaceChildren(status.textContent);
    } catch (err) {
      status.textContent = `Import failed: ${err.message}`;
    }
  });

  const mk = (text, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "secondary";
    b.textContent = text;
    b.addEventListener("click", fn);
    return b;
  };
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h2");
  h.textContent = "Backup";
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = "Your edited times and checked-off items live only in this browser. Export them to a file, or restore from one (import replaces current data).";
  const row = document.createElement("div");
  row.className = "actions-row";
  row.append(mk("Export data", exportFile), mk("Import data", () => file.click()), file);
  card.append(h, p, row, status);
  return card;
}
