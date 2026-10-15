// Sync card (About tab) and the small header status chip. Both render from
// engine.getState() and update in place when the engine notifies.
import { el as h } from "./dom.js";
import { syncView, errorMessage } from "./accountdata.js";
import { getEngine, isSyncConfigured, setRerender, startEngineIfSignedIn, hasPreLinkSnapshot, requestRerender } from "./syncclient.js";
import { openAccountSheet, openModal } from "./accountui.js";
import { showToast } from "./toast.js";

const safeState = () => { try { return getEngine()?.getState() || null; } catch { return null; } };

/** One call at startup (after write tracking, before the first render). */
export function startSyncUi(rerender) {
  setRerender(rerender);
  startEngineIfSignedIn();
  initChip();
}

/** Subscribe; returns an unsubscribe function (tolerates engines that return nothing). */
function watch(fn) {
  const engine = getEngine();
  if (!engine) return () => {};
  const off = engine.subscribe(fn);
  let live = true;
  return () => { if (live && typeof off === "function") off(); live = false; };
}

// ---- header chip ----
function initChip() {
  if (!isSyncConfigured()) return;
  const bar = document.querySelector(".topbar");
  if (!bar || document.getElementById("sync-chip")) return;
  const chip = h("button", { type: "button", class: "sync-chip", id: "sync-chip", hidden: "hidden", onclick: () => document.dispatchEvent(new CustomEvent("planner:tab", { detail: "about" })) });
  bar.classList.add("has-sync-chip");
  bar.appendChild(chip);
  const paint = () => {
    const v = syncView(safeState(), true);
    chip.hidden = !v.chip;
    if (!v.chip) return;
    chip.textContent = v.chip;
    chip.dataset.kind = v.kind;
    chip.setAttribute("aria-label", `Cloud sync: ${v.chip}. Open About for details.`);
  };
  paint();
  watch(paint);
  setInterval(paint, 60000);
}

// ---- confirm dialogs ----
function confirmDialog({ title, body, confirmLabel, danger = false, run }) {
  const m = openModal({ labelledBy: "sync-confirm-title", describedBy: "sync-confirm-body", className: "sync-confirm" });
  const err = h("div", { class: "ob-err", role: "alert" });
  const go = h("button", {
    type: "button", class: `primary${danger ? " danger" : ""}`, id: "sync-confirm-go",
    onclick: async () => {
      if (go.getAttribute("aria-disabled") === "true") return;
      go.setAttribute("aria-disabled", "true");
      err.textContent = "";
      try { await run(); m.close(); } catch (e) { go.setAttribute("aria-disabled", "false"); err.textContent = errorMessage(e); }
    },
  }, confirmLabel);
  m.dialog.append(
    h("h2", { id: "sync-confirm-title" }, title),
    h("p", { id: "sync-confirm-body" }, body),
    err,
    h("div", { class: "ob-actions" }, [h("button", { type: "button", class: "secondary", id: "sync-confirm-cancel", onclick: () => m.close() }, "Cancel"), go]),
  );
  m.dialog.querySelector("#sync-confirm-cancel").focus();
}

function deleteCloudDialog() {
  confirmDialog({
    title: "Delete my cloud data?",
    body: "This permanently deletes the planner data stored in the cloud for this account. The data on this device is not touched.",
    confirmLabel: "Delete cloud data",
    danger: true,
    run: async () => { await getEngine().deleteCloudData(); showToast("Cloud data deleted. Your data on this device is unchanged."); },
  });
}

function undoLinkDialog() {
  confirmDialog({
    title: "Undo the last link?",
    body: "This puts back the data this device had before it was linked to the account. Anything added since then on this device is replaced.",
    confirmLabel: "Undo last link",
    run: async () => {
      const ok = await getEngine().restorePreLinkSnapshot();
      if (ok === false) throw Object.assign(new Error("none"), { code: "none" });
      showToast("Restored this device's data from before the link.");
      requestRerender();
    },
  });
}

// ---- Sync card ----
export function syncCard() {
  const card = h("div", { class: "card sync-card", id: "sync-card" });
  const title = h("h2", {}, "Cloud sync");
  card.appendChild(title);
  if (!isSyncConfigured()) {
    card.appendChild(h("p", { class: "muted", id: "sync-line" }, "Cloud sync isn't set up yet"));
    return card;
  }
  const line = h("p", { class: "sync-line", id: "sync-line" });
  const detail = h("p", { class: "muted sync-detail", id: "sync-detail" });
  const actions = h("div", { class: "actions-row sync-actions", id: "sync-actions" });
  const live = h("div", { class: "sync-sr", role: "status", "aria-live": "polite" });
  card.append(line, detail, actions, live);

  let lastKind = null;
  let sig = "";
  const engine = getEngine();
  const btn = (id, label, fn, cls = "secondary", disabled = false) =>
    h("button", { type: "button", class: cls, id, onclick: fn, disabled: disabled ? "disabled" : null }, label);

  function paint() {
    const st = safeState();
    const v = syncView(st, true);
    if (line.textContent !== v.text) line.textContent = v.text;
    if (detail.textContent !== v.detail) detail.textContent = v.detail;
    detail.hidden = !v.detail;
    if (lastKind !== null && lastKind !== v.kind) {
      live.textContent = { idle: "Synced", syncing: "Syncing", offline: "Offline", error: "Sync problem", "signed-out": "Signed out" }[v.kind] || "";
    }
    lastKind = v.kind;
    const snap = v.signedIn && hasPreLinkSnapshot();
    const nextSig = `${v.kind}|${snap}`;
    if (nextSig === sig) return;
    sig = nextSig;
    const activeId = card.contains(document.activeElement) ? document.activeElement.id : null;
    actions.replaceChildren();
    if (v.kind === "signed-out") {
      actions.append(
        btn("sync-signin", "Sign in", () => openAccountSheet({ mode: "signin" }), "primary"),
        btn("sync-signup", "Create account", () => openAccountSheet({ mode: "signup" })),
      );
    } else {
      actions.append(
        btn("sync-now", v.kind === "error" ? "Try again" : "Sync now", () => { Promise.resolve(engine.syncNow()).catch(() => {}); }, "secondary", v.kind === "syncing"),
        btn("sync-signout", "Sign out", async () => { await engine.logout(); showToast("Signed out. Your data stays on this device."); }),
      );
      if (snap) actions.append(btn("sync-undo-link", "Undo last link", undoLinkDialog));
      actions.append(btn("sync-delete", "Delete my cloud data", deleteCloudDialog, "secondary danger-text"));
    }
    if (activeId) (card.querySelector(`#${activeId}`) || card.querySelector("button:not([disabled])"))?.focus();
  }
  paint();

  let off = () => {};
  let timer = null;
  const stop = () => { off(); clearInterval(timer); };
  let seen = false;
  const tick = () => { if (!card.isConnected) { if (seen) stop(); return; } seen = true; paint(); };
  off = watch(tick);
  timer = setInterval(tick, 30000);
  return card;
}
