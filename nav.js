// Bottom tab bar + "More" sheet. Pure helpers (tab lists) are exported for tests;
// the DOM wiring only runs from initNav().
export const PRIMARY_TABS = ["today", "log", "insights", "plan"];
export const SECONDARY_TABS = ["week", "workout", "meds", "about"];
export const ALL_TABS = [...PRIMARY_TABS, ...SECONDARY_TABS];

export const isSecondary = (tab) => SECONDARY_TABS.includes(tab);
export const isKnownTab = (tab) => ALL_TABS.includes(tab);

let sheet, backdrop, moreBtn;

export function isMoreOpen() {
  return !!sheet && !sheet.hidden;
}

export function closeMore({ restoreFocus = false } = {}) {
  if (!sheet || sheet.hidden) return;
  sheet.hidden = true;
  backdrop.hidden = true;
  moreBtn.setAttribute("aria-expanded", "false");
  if (restoreFocus) moreBtn.focus();
}

export function openMore() {
  if (!sheet) return;
  sheet.hidden = false;
  backdrop.hidden = false;
  moreBtn.setAttribute("aria-expanded", "true");
  (sheet.querySelector(".more-item.active") || sheet.querySelector(".more-item"))?.focus();
}

/** Reflect the selected tab in the bar and the sheet. */
export function syncNav(tab) {
  document.querySelectorAll("[data-tab]").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === tab);
    if (el.classList.contains("more-item")) el.setAttribute("aria-current", el.dataset.tab === tab ? "page" : "false");
  });
  moreBtn?.classList.toggle("active", isSecondary(tab));
  closeMore();
}

export function initNav(select) {
  sheet = document.getElementById("more-sheet");
  backdrop = document.getElementById("more-backdrop");
  moreBtn = document.getElementById("more-btn");
  if (!sheet || !backdrop || !moreBtn) return;

  document.getElementById("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn === moreBtn) { isMoreOpen() ? closeMore() : openMore(); return; }
    if (btn.dataset.tab) select(btn.dataset.tab);
  });
  sheet.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (btn) select(btn.dataset.tab);
  });
  backdrop.addEventListener("click", () => closeMore());
  document.addEventListener("keydown", (e) => {
    if (!isMoreOpen()) return;
    const items = [...sheet.querySelectorAll(".more-item")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); closeMore({ restoreFocus: true }); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === "Tab") {
      // Keep keyboard focus inside the open menu; Tab/Shift+Tab wraps.
      e.preventDefault();
      items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
    }
  });
  // Other modules (Plan tab, onboarding) can ask for a tab without importing app.js.
  document.addEventListener("planner:tab", (e) => { if (isKnownTab(e.detail)) select(e.detail); });
}
