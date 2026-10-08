// Best-effort local reminders. A static site has no push server, so these
// fire only while the app (browser tab or installed PWA) is open or still
// alive in the background. True background push would need a backend.

const PREF_KEY = "elevate-planner-reminders"; // not prefixed: excluded from backups
const LEAD_MIN = 2;
let timers = [];

export function remindersSupported() {
  return typeof Notification !== "undefined";
}

export function remindersEnabled() {
  try {
    return remindersSupported() && Notification.permission === "granted" && localStorage.getItem(PREF_KEY) === "on";
  } catch {
    return false;
  }
}

export async function setRemindersEnabled(on) {
  if (!remindersSupported()) return false;
  if (on && Notification.permission !== "granted") {
    const p = await Notification.requestPermission();
    if (p !== "granted") return false;
  }
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
  return true;
}

async function notify(item) {
  const opts = { body: item.notes || "", tag: item.id, icon: "icons/icon-192.png" };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(item.label, opts);
  } catch {
    /* fall through */
  }
  new Notification(item.label, opts);
}

/**
 * (Re)schedule today's reminders. Call after any change to today's items.
 * @param {Array} items - computeDay() output for today; done items are skipped.
 */
export function scheduleReminders(items) {
  timers.forEach(clearTimeout);
  timers = [];
  if (!remindersEnabled()) return;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  for (const item of items) {
    if (item.done) continue;
    const delayMs = (item.minutes - LEAD_MIN - nowMin) * 60000;
    if (delayMs < 0 || delayMs > 86400000) continue;
    timers.push(setTimeout(() => notify(item), delayMs));
  }
}
