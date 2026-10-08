// Service worker: offline app shell. Bump CACHE on every release that changes a
// cached file (tests/shell.test.mjs fails if a repo file is missing from SHELL).
// A new worker waits until the page asks it to activate (SKIP_WAITING message,
// sent from the "New version available" banner in pwa.js).
const CACHE = "day-planner-v4";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "engine.js", "data.js", "ics.js",
  "pwa.js", "theme.js", "a11y.js", "backup.js", "boot.js",
  "log.js", "reminders.js", "logstore.js", "meds.js", "week.js", "grouping.js", "progress.js",
  "report.js", "reportdata.js",
  "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
  "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
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
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) =>
      wins.length ? wins[0].focus() : self.clients.openWindow("./")
    )
  );
});
