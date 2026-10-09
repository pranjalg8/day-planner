// Service worker: offline app shell. Bump CACHE on every release that changes a
// cached file (tests/shell.test.mjs fails if a repo file is missing from SHELL).
// A new worker waits until the page asks it to activate (SKIP_WAITING message,
// sent from the "New version available" banner in pwa.js).
const CACHE = "day-planner-v8";
const SHELL = [
  "./", "index.html", "style.css", "manifest.webmanifest",
  "a11y.js", "actions.js", "app.js", "backup.js", "backupnudge.js", "boot.js", "catchup.js", "data.js", "dom.js", "engine.js", "grocery.js", "ics.js", "insights.js", "insightsdata.js", "log.js", "logstore.js", "meds.js", "missed.js", "nav.js", "onboarding.js", "onboardingdata.js", "plan.js", "planstore.js", "programcard.js", "progress.js", "pwa.js", "reminders.js", "report.js", "reportdata.js", "theme.js", "toast.js", "week.js",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/icon.svg",
];

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", (e) => {
  // Add individually so one missing optional file (other branches) doesn't abort install.
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => (req.mode === "navigate" ? caches.match("index.html") : Response.error()));
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  if (e.action) return; // done/snooze handled by the handler at the end of this file
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) =>
      wins.length ? wins[0].focus() : self.clients.openWindow("./")
    )
  );
});

// === daily: notification action buttons (Done / Snooze) ===
// The SW can't touch localStorage, so tell an open page to apply the action;
// with no page open, open the app with a query string it applies on load.
self.addEventListener("notificationclick", (e) => {
  if (e.action !== "done" && e.action !== "snooze") return;
  const data = e.notification.data || {};
  if (!data.id) return;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      if (wins.length) {
        wins.forEach((w) => w.postMessage({ type: "planner-action", action: e.action, id: data.id, date: data.date }));
        return undefined;
      }
      const q = new URLSearchParams({ [e.action]: data.id });
      if (data.date) q.set("date", data.date);
      return self.clients.openWindow("./?" + q.toString());
    })
  );
});
