// Accessibility helpers that don't require touching render code:
// keeps the bottom bar's aria-current in sync, labels checkboxes/inputs, makes
// scrollable tables keyboard reachable.
const tabs = document.getElementById("tabs");
function syncTabs() {
  tabs.querySelectorAll(".tab").forEach((t) => {
    const isMore = t.id === "more-btn";
    if (t.classList.contains("active")) t.setAttribute("aria-current", isMore ? "true" : "page");
    else t.removeAttribute("aria-current");
  });
}
if (tabs) {
  syncTabs();
  new MutationObserver(syncTabs).observe(tabs, { attributes: true, subtree: true, attributeFilter: ["class"] });
}

const app = document.getElementById("app");
function label() {
  // Wide tables scroll inside a focusable wrapper instead of stretching the page.
  app.querySelectorAll("table").forEach((tb) => {
    if (tb.parentElement.classList.contains("table-scroll")) return;
    const wrap = document.createElement("div");
    wrap.className = "table-scroll";
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    const h = tb.closest(".card")?.querySelector("h2")?.textContent?.trim();
    wrap.setAttribute("aria-label", h ? `${h} table` : "Table");
    tb.replaceWith(wrap);
    wrap.appendChild(tb);
  });
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
