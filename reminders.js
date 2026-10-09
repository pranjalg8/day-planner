// Best-effort local reminders. A static site has no push server, so these
// fire only while the app (browser tab or installed PWA) is open or still
// alive in the background. True background push would need a backend.

const PREF_KEY = "elevate-planner-reminders"; // not prefixed: excluded from backups
const LEAD_MIN = 2;
const SNOOZE_MIN = 15;
let timers = [];
const snoozeTimers = new Map(); // item id -> timeout (kept across scheduleReminders)

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
    if (reg) {
      const d = new Date();
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return reg.showNotification(item.label, {
        ...opts,
        data: { id: item.id, date },
        actions: [
          { action: "done", title: "Done" },
          { action: "snooze", title: `Snooze ${SNOOZE_MIN} min` },
        ],
      });
    }
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

/**
 * Re-notify for an item after `mins` minutes (in-page timer; same best-effort
 * limits as other reminders). Returns false if reminders are off.
 */
export function snoozeItem(item, mins = SNOOZE_MIN) {
  if (!remindersEnabled()) return false;
  clearTimeout(snoozeTimers.get(item.id));
  snoozeTimers.set(item.id, setTimeout(() => { snoozeTimers.delete(item.id); notify(item); }, mins * 60000));
  return true;
}
