// Account sheet (sign in / create account) plus a small shared modal helper.
// The PIN is only ever held in the input fields and passed to the engine; it is
// never stored or logged, and the fields are cleared after every attempt.
import { el as h } from "./dom.js";
import { validateAccount, errorMessage, linkNotice, differentAccountText } from "./accountdata.js";
import { getEngine, localCounts, afterAuth } from "./syncclient.js";
import { showToast } from "./toast.js";

/** Accessible modal: overlay + dialog, focus trap, Escape, focus restore. */
export function openModal({ labelledBy, describedBy = null, className = "", onClose = null }) {
  const opener = document.activeElement;
  const overlay = h("div", { class: "ob-overlay sync-overlay" });
  const dialog = h("div", { class: `ob-dialog sync-dialog ${className}`.trim(), role: "dialog", "aria-modal": "true", "aria-labelledby": labelledBy, "aria-describedby": describedBy });
  overlay.appendChild(dialog);
  let closed = false;

  const focusables = () => [...dialog.querySelectorAll("button, input, a[href], select, textarea")].filter((n) => !n.disabled && !n.hidden && n.getClientRects().length);
  function onKey(e) {
    const all = document.querySelectorAll(".ob-overlay");
    if (all[all.length - 1] !== overlay) return; // a newer dialog is on top
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== "Tab") return;
    const f = focusables();
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    if (!document.querySelector(".ob-overlay")) document.body.classList.remove("ob-open");
    const target = opener && opener.isConnected ? opener : document.querySelector("#sync-card button");
    try { target?.focus?.(); } catch { /* ignore */ }
    onClose?.();
  }
  document.addEventListener("keydown", onKey, true);
  document.body.classList.add("ob-open");
  document.body.appendChild(overlay);
  return { overlay, dialog, close, focusables };
}

/** Normalise engine results that report failure instead of throwing. */
async function call(fn) {
  const res = await fn();
  if (res && res.ok === false) throw Object.assign(new Error(res.message || "failed"), { code: res.code || res.error?.code, retryAfterSec: res.retryAfterSec, linkedName: res.linkedName });
  return res;
}

let sheetOpen = false;

/** Opens the account sheet. mode: "signin" | "signup". onSuccess({ mode, name }) after a good login. */
export function openAccountSheet({ mode = "signin", onSuccess = null } = {}) {
  const engine = getEngine();
  if (!engine || sheetOpen) return;
  sheetOpen = true;
  const counts = localCounts();
  const linked = !!(engine.getState && engine.getState().linkedName);
  const notice = linked ? null : linkNotice(counts);

  let name = "";
  let showPin = false;
  let busy = false;
  const m = openModal({ labelledBy: "acct-title", className: "acct-dialog", onClose: () => { sheetOpen = false; } });
  const { dialog, close } = m;
  let nameIn, pinIn, pin2In, submitBtn, formErr, errEls = {};

  function setErrors(errors) {
    for (const f of ["name", "pin", "pin2"]) {
      const input = { name: nameIn, pin: pinIn, pin2: pin2In }[f];
      if (!input) continue;
      errEls[f].textContent = errors[f] || "";
      if (errors[f]) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
    }
    return ["name", "pin", "pin2"].map((f) => ({ name: nameIn, pin: pinIn, pin2: pin2In }[f])).find((i, idx) => i && errors[["name", "pin", "pin2"][idx]]);
  }
  const clearPins = () => { if (pinIn) pinIn.value = ""; if (pin2In) pin2In.value = ""; };
  function setBusy(b) {
    busy = b;
    submitBtn.setAttribute("aria-disabled", b ? "true" : "false");
    submitBtn.textContent = b ? (mode === "signup" ? "Creating…" : "Signing in…") : (mode === "signup" ? "Create account" : "Sign in");
    dialog.setAttribute("aria-busy", b ? "true" : "false");
  }

  function field(id, label, input, hint) {
    const err = h("div", { class: "ob-err acct-err", id: `${id}-err` });
    errEls[{ "acct-name": "name", "acct-pin": "pin", "acct-pin2": "pin2" }[id]] = err;
    return h("div", { class: "acct-field" }, [
      h("label", { for: id }, label),
      input,
      hint ? h("div", { class: "muted acct-hint", id: `${id}-hint` }, hint) : null,
      err,
    ]);
  }

  function paint() {
    const create = mode === "signup";
    errEls = {};
    dialog.replaceChildren();
    nameIn = h("input", { id: "acct-name", type: "text", name: "username", autocomplete: "username", autocapitalize: "off", autocorrect: "off", spellcheck: "false", maxlength: "64", value: name, "aria-describedby": "acct-name-hint acct-name-err" });
    const pinAttrs = (id, ac, desc) => ({ id, type: showPin ? "text" : "password", inputmode: "numeric", pattern: "[0-9]*", autocomplete: ac, maxlength: "8", autocapitalize: "off", spellcheck: "false", "aria-describedby": desc });
    pinIn = h("input", pinAttrs("acct-pin", create ? "new-password" : "current-password", "acct-pin-hint acct-pin-err"));
    pin2In = create ? h("input", pinAttrs("acct-pin2", "new-password", "acct-pin2-err")) : null;
    formErr = h("div", { class: "ob-err acct-form-err", id: "acct-form-err", role: "alert" });
    submitBtn = h("button", { type: "submit", class: "primary", id: "acct-submit" }, create ? "Create account" : "Sign in");
    const toggle = h("button", {
      type: "button", class: "link-btn", id: "acct-show", "aria-pressed": showPin ? "true" : "false",
      onclick: () => { showPin = !showPin; for (const i of [pinIn, pin2In]) if (i) i.type = showPin ? "text" : "password"; toggle.setAttribute("aria-pressed", showPin ? "true" : "false"); },
    }, "Show PIN");

    const form = h("form", { id: "acct-form", novalidate: "novalidate", onsubmit: submit }, [
      field("acct-name", "Name", nameIn, "2 to 32 characters."),
      field("acct-pin", "PIN", pinIn, create ? "4 to 8 digits. Remember it: it can't be reset." : "4 to 8 digits."),
      create ? field("acct-pin2", "Repeat PIN", pin2In, null) : null,
      toggle,
      formErr,
      h("div", { class: "ob-actions acct-actions" }, [
        h("button", { type: "button", class: "secondary", id: "acct-cancel", onclick: () => close() }, "Cancel"),
        submitBtn,
      ]),
    ]);
    dialog.append(...[
      h("h2", { id: "acct-title" }, create ? "Create account" : "Sign in"),
      h("p", { class: "muted" }, create ? "Choose a name and a PIN to sync your planner across devices." : "Enter your name and PIN to sync this device."),
      notice ? h("p", { class: "acct-notice", id: "acct-link-notice" }, notice) : null,
      form,
      h("button", { type: "button", class: "link-btn acct-switch", id: "acct-switch", onclick: () => { name = nameIn.value; mode = create ? "signin" : "signup"; paint(); nameIn.focus(); } },
        create ? "Already have an account? Sign in" : "New here? Create account"),
      h("p", { class: "muted acct-hint acct-order" }, "Using more than one device? Create the account on the device with the most data first, then sign in on the others."),
    ].filter(Boolean));
  }

  async function attempt(n, pin, options) {
    const fn = mode === "signup" ? engine.signup : engine.login;
    return call(() => (options ? fn.call(engine, n, pin, options) : fn.call(engine, n, pin)));
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const n = nameIn.value.trim();
    const pin = pinIn.value;
    const errors = validateAccount(mode, { name: n, pin, pin2: pin2In ? pin2In.value : undefined });
    const bad = setErrors(errors);
    formErr.textContent = "";
    if (bad) { bad.focus(); return; }
    setBusy(true);
    try {
      await attempt(n, pin, null);
    } catch (err) {
      if (err && err.code === "different_account") { confirmReplace(n, pin, err.linkedName); return; }
      return fail(err);
    } finally {
      if (!dialog.querySelector("#acct-replace")) clearPins();
    }
    success(n);
  }

  function fail(err) {
    setBusy(false);
    clearPins();
    formErr.textContent = errorMessage(err);
    (err && err.code === "name_taken" ? nameIn : pinIn).focus();
  }

  function success(n) {
    clearPins();
    close();
    showToast(mode === "signup" ? `Account created. Signed in as ${n}.` : `Signed in as ${n}.`);
    onSuccess?.({ mode, name: n });
    afterAuth();
  }

  // This device is linked to another account: ask before replacing local data.
  function confirmReplace(n, pin, linkedName) {
    // The PIN is held only in this closure until the user decides, then dropped.
    let held = pin;
    clearPins();
    dialog.replaceChildren(
      h("h2", { id: "acct-title" }, "Replace this device's data?"),
      h("p", { id: "acct-replace", class: "acct-notice" }, differentAccountText(linkedName || "another account", n)),
      h("div", { class: "ob-err acct-form-err", id: "acct-form-err", role: "alert" }),
      h("div", { class: "ob-actions acct-actions" }, [
        h("button", { type: "button", class: "secondary", id: "acct-replace-cancel", onclick: () => { held = null; close(); } }, "Cancel"),
        h("button", {
          type: "button", class: "primary", id: "acct-replace-go",
          onclick: async (ev) => {
            const btn = ev.currentTarget;
            if (btn.getAttribute("aria-disabled") === "true") return;
            btn.setAttribute("aria-disabled", "true");
            try {
              await attempt(n, held, { replaceLocal: true });
              held = null;
              success(n);
            } catch (err) {
              held = null;
              dialog.querySelector("#acct-form-err").textContent = `${errorMessage(err)} Close this and try again.`;
              btn.hidden = true;
              dialog.querySelector("#acct-replace-cancel").focus();
            }
          },
        }, "Replace this device's data"),
      ]),
    );
    dialog.querySelector("#acct-replace-cancel").focus();
  }

  paint();
  nameIn.focus();
}
