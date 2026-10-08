// Accessibility helpers that don't require touching render code:
// keeps tab aria-selected in sync, labels time checkboxes and inputs.
const tabs = document.getElementById("tabs");
function syncTabs() {
  tabs.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.classList.contains("active"))));
}
if (tabs) {
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Sections");
  tabs.querySelectorAll(".tab").forEach((t) => { t.setAttribute("role", "tab"); });
  syncTabs();
  new MutationObserver(syncTabs).observe(tabs, { attributes: true, subtree: true, attributeFilter: ["class"] });
}

const app = document.getElementById("app");
function label() {
  app.setAttribute("role", "tabpanel");
  app.querySelectorAll("input.checkbox:not([aria-label])").forEach((cb) => {
    const item = cb.closest(".item");
    const name = item?.querySelector(".item-label")?.textContent?.trim() || "item";
    const time = item?.querySelector(".item-time")?.textContent?.trim() || "";
    cb.setAttribute("aria-label", `Mark done: ${name}${time ? " at " + time : ""}`);
  });
  app.querySelectorAll("input[type=time]:not([aria-label])").forEach((i) => {
    const t = i.closest("label")?.textContent?.trim();
    i.setAttribute("aria-label", `${t || "Time"} time`);
  });
}
if (app) {
  label();
  new MutationObserver(label).observe(app, { childList: true, subtree: true });
}
