// Pure logic for the account sheet and the Sync card: validation, error
// messages, relative time and the state -> view mapping. No DOM, no storage.
export const NAME_MIN = 2;
export const NAME_MAX = 32;
export const PIN_MIN = 4;
export const PIN_MAX = 8;

/** Error message for a name, or null when fine. The name is trimmed first. */
export function validateName(name) {
  const n = String(name ?? "").trim();
  if (n.length < NAME_MIN || n.length > NAME_MAX) return `Name must be ${NAME_MIN} to ${NAME_MAX} characters.`;
  return null;
}

/** Error message for a PIN (digits only, 4 to 8), or null. */
export function validatePin(pin) {
  const p = String(pin ?? "");
  if (!new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(p)) return `PIN must be ${PIN_MIN} to ${PIN_MAX} digits (numbers only).`;
  return null;
}

export function validatePinMatch(pin, pin2) {
  return String(pin ?? "") === String(pin2 ?? "") ? null : "The two PINs don't match.";
}

/** mode: "signin" | "signup". Returns { name?, pin?, pin2? } (empty object = valid). */
export function validateAccount(mode, { name, pin, pin2 } = {}) {
  const errors = {};
  const n = validateName(name);
  if (n) errors.name = n;
  const p = validatePin(pin);
  if (p) errors.pin = p;
  if (mode === "signup" && !p) {
    const m = validatePinMatch(pin, pin2);
    if (m) errors.pin2 = m;
  }
  return errors;
}

/** Friendly message for an engine/adapter error ({ code, retryAfterSec }). */
export function errorMessage(err) {
  const code = err && err.code;
  switch (code) {
    case "name_taken": return "That name is taken. Try another or sign in.";
    case "unauthorized": return "Name or PIN is wrong.";
    case "locked": {
      const s = Number(err.retryAfterSec);
      const min = Number.isFinite(s) && s > 0 ? Math.max(1, Math.ceil(s / 60)) : null;
      return min ? `Too many tries. Try again in ${min} min.` : "Too many tries. Try again in a few minutes.";
    }
    case "invalid": return `Check your details: name ${NAME_MIN} to ${NAME_MAX} characters, PIN ${PIN_MIN} to ${PIN_MAX} digits.`;
    case "network": return "No connection. You can keep using the app offline and try again.";
    default: return "Something went wrong. Please try again.";
  }
}

/** "just now" / "5 min ago" / "2 h ago" / "yesterday" / "3 days ago" / "never". */
export function formatRelativeTime(ts, now = Date.now()) {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "never";
  const sec = Math.floor((now - ts) / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${Math.max(1, min)} min ago`;
  const h = Math.floor(sec / 3600);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(sec / 86400);
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

/** True when any key is planner data (a pulled profile or day docs). */
export function hasPlannerData(keys) {
  for (const k of keys || []) if (typeof k === "string" && k.startsWith("elevate-planner:")) return true;
  return false;
}

/** "This device has N days of data. ..." or null when there is nothing to merge. */
export function linkNotice(counts) {
  if (!counts) return null;
  const days = Number(counts.days) || 0;
  if (days > 0) {
    return `This device has ${days} ${days === 1 ? "day" : "days"} of data. Signing in adds it to this account, and anything already in the account is kept (the two are merged).`;
  }
  if (counts.hasOtherData) {
    return "This device has planner data. Signing in adds it to this account, and anything already in the account is kept (the two are merged).";
  }
  return null;
}

/** Sentence shown when the engine says this device is linked to another account. */
export function differentAccountText(linkedName, name) {
  return `This device is linked to ${linkedName}. To sign in as ${name} it must first replace this device's data with that account's data. A copy is saved so you can undo.`;
}

/**
 * Engine state -> what the Sync card and chip show.
 * kind: unconfigured | signed-out | idle | syncing | offline | error
 */
export function syncView(state, configured, now = Date.now()) {
  if (!configured || !state || state.status === "off") {
    return { kind: "unconfigured", text: "Cloud sync isn't set up yet", detail: "", chip: null, signedIn: false };
  }
  const name = state.name || state.linkedName || "";
  const pend = state.pending > 0 ? ` · ${state.pending} ${state.pending === 1 ? "change" : "changes"} waiting` : "";
  switch (state.status) {
    case "signed-out":
      return { kind: "signed-out", text: "Sign in to sync across devices", detail: "", chip: null, signedIn: false };
    case "syncing":
      return { kind: "syncing", text: `Signed in as ${name} · Syncing…`, detail: "", chip: "Syncing…", signedIn: true };
    case "offline":
      return { kind: "offline", text: `Signed in as ${name} · Offline`, detail: `Changes are saved on this device and sync when you're back online${pend}.`, chip: "Offline", signedIn: true };
    case "error":
      return { kind: "error", text: `Signed in as ${name} · Sync problem`, detail: state.error || "Sync hit a problem. Your data is safe on this device.", chip: "Sync issue", signedIn: true };
    default:
      return { kind: "idle", text: `Signed in as ${name} · Last synced ${formatRelativeTime(state.lastSyncAt, now)}${pend}`, detail: "", chip: "Synced", signedIn: true };
  }
}
