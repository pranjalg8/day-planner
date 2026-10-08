// Registers the service worker (secure contexts / localhost only; never throws)
// and shows a "New version available" banner when an updated worker is waiting.
let updateRequested = false;

function showUpdateBanner(reg) {
  if (document.getElementById("update-banner")) return;
  const bar = document.createElement("div");
  bar.id = "update-banner";
  bar.className = "update-banner";
  bar.setAttribute("role", "status");
  const msg = document.createElement("span");
  msg.textContent = "New version available";
  const go = document.createElement("button");
  go.type = "button";
  go.className = "update-refresh";
  go.textContent = "Refresh";
  go.addEventListener("click", () => {
    updateRequested = true;
    go.disabled = true;
    go.textContent = "Updating…";
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    else location.reload();
  });
  const x = document.createElement("button");
  x.type = "button";
  x.className = "update-dismiss";
  x.setAttribute("aria-label", "Dismiss update notice");
  x.textContent = "×";
  x.addEventListener("click", () => bar.remove());
  bar.append(msg, go, x);
  document.body.appendChild(bar);
}

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !updateRequested) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      // Only offer when an older worker controls this page (not on first install).
      const offer = () => { if (navigator.serviceWorker.controller) showUpdateBanner(reg); };
      if (reg.waiting) offer();
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        if (w) w.addEventListener("statechange", () => { if (w.state === "installed") offer(); });
      });
      document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch((err) => console.warn("SW registration failed", err));
  });
}
