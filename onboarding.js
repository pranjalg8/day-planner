// First-run setup: a short, skippable, one-time modal flow. Pure logic lives in
// onboardingdata.js. The "done" flag (ONBOARDED_KEY) is deliberately outside the
// "elevate-planner:" prefix so backups don't export/restore it.
import { DEFAULT_TIMES, WORKOUT } from "./data.js";
import { loadPlan, savePlan, effectiveTimes, effectiveWorkoutDays, dateKeyOf } from "./planstore.js";
import { setWeight } from "./logstore.js";
import { setGoal, readAll } from "./insightsdata.js";
import { remindersSupported, remindersEnabled, setRemindersEnabled } from "./reminders.js";
import { ONBOARDED_KEY, STEPS, TIME_FIELDS, TIME_LABELS, validateStep, validateAll, applyToPlan, sideEffects } from "./onboardingdata.js";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function h(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (k === "value") n.value = v;
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}

function isOnboarded() {
  try { return localStorage.getItem(ONBOARDED_KEY) === "1"; } catch { return true; } // no storage: never nag
}
function markOnboarded() {
  try { localStorage.setItem(ONBOARDED_KEY, "1"); } catch { /* ignore */ }
}
/** A returning user (existing planner data from before this feature) is not nagged. */
function hasExistingData() {
  try {
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith("elevate-planner:")) return true;
  } catch { /* ignore */ }
  return false;
}

/** Call once at startup, before the first render. */
export function startOnboardingIfNeeded(rerender) {
  if (isOnboarded()) return;
  const q = new URLSearchParams(location.search);
  if (hasExistingData() || q.has("done") || q.has("snooze")) { markOnboarded(); return; }
  openOnboarding(rerender);
}

function currentAnswers() {
  const t = effectiveTimes();
  const wt = readAll();
  return {
    times: Object.fromEntries(TIME_FIELDS.map((f) => [f, t[f] || DEFAULT_TIMES[f]])),
    workoutDays: [...effectiveWorkoutDays(loadPlan())],
    startWeight: "",
    goalWeight: wt.goal ? String(wt.goal) : "",
    reminders: remindersEnabled(),
  };
}

let openDialog = null;

export function openOnboarding(rerender) {
  if (openDialog) return;
  const answers = currentAnswers();
  let step = 0;
  let errors = {};
  const previouslyFocused = document.activeElement;

  const overlay = h("div", { class: "ob-overlay", id: "onboarding" });
  const dialog = h("div", { class: "ob-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "ob-title" });
  overlay.appendChild(dialog);
  openDialog = overlay;
  document.body.appendChild(overlay);
  document.body.classList.add("ob-open");

  function close() {
    markOnboarded();
    overlay.remove();
    openDialog = null;
    document.body.classList.remove("ob-open");
    document.removeEventListener("keydown", onKey, true);
    try { previouslyFocused?.focus?.(); } catch { /* ignore */ }
    rerender?.();
  }

  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const f = [...dialog.querySelectorAll("button, input, select")].filter((n) => !n.disabled);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener("keydown", onKey, true);

  const err = (field) => (errors[field] ? h("div", { class: "ob-err", role: "alert" }, errors[field]) : null);

  async function finish() {
    errors = validateAll(answers);
    if (Object.keys(errors).length) {
      // Jump to the first step with a problem.
      step = STEPS.findIndex((s) => Object.keys(validateStep(s, answers)).length);
      paint();
      return;
    }
    savePlan(applyToPlan(loadPlan(), answers));
    const fx = sideEffects(answers);
    if (fx.startWeight !== null) setWeight(dateKeyOf(new Date()), fx.startWeight);
    if (fx.goalWeight !== null) setGoal(fx.goalWeight);
    if (fx.reminders !== remindersEnabled()) {
      const ok = await setRemindersEnabled(fx.reminders);
      if (!ok && fx.reminders) answers.reminders = false;
    }
    close();
  }

  function body() {
    const s = STEPS[step];
    if (s === "times") {
      return [
        h("h2", { id: "ob-title" }, "Your daily rhythm"),
        h("p", { class: "muted" }, "When do you usually wake up and eat? Medicine buffers and walks are scheduled from these."),
        h("div", { class: "ob-grid" }, TIME_FIELDS.map((f) =>
          h("label", {}, [TIME_LABELS[f], h("input", { type: "time", "data-ob": f, value: answers.times[f], oninput: (e) => { answers.times[f] = e.target.value; } }), err(f)]))),
        err("times"),
      ];
    }
    if (s === "workout") {
      return [
        h("h2", { id: "ob-title" }, "Workout days"),
        h("p", { class: "muted" }, "Which weekdays do you want the morning circuit and evening stretching? Leave all off for none."),
        h("div", { class: "day-toggles", role: "group", "aria-label": "Workout weekdays" }, DAY_SHORT.map((name, wd) =>
          h("label", { class: `day-toggle${answers.workoutDays.includes(wd) ? " on" : ""}` }, [
            h("input", {
              type: "checkbox", "data-wd": String(wd), checked: answers.workoutDays.includes(wd) ? "checked" : null,
              onchange: (e) => {
                const set = new Set(answers.workoutDays);
                e.target.checked ? set.add(wd) : set.delete(wd);
                answers.workoutDays = [...set].sort((a, b) => a - b);
                e.target.closest("label").classList.toggle("on", e.target.checked);
              },
            }),
            h("span", {}, name),
          ]))),
        err("workoutDays"),
        h("p", { class: "muted ob-small" }, `Program default: ${WORKOUT.days.map((d) => DAY_SHORT[d]).join(", ")}.`),
      ];
    }
    if (s === "weight") {
      return [
        h("h2", { id: "ob-title" }, "Weight (optional)"),
        h("p", { class: "muted" }, "Your starting weight is logged for today; the goal draws a line on the Insights chart. Both stay on this device."),
        h("div", { class: "ob-grid" }, [
          h("label", {}, ["Starting weight (kg)", h("input", { type: "text", inputmode: "decimal", id: "ob-start", placeholder: "e.g. 78.5", value: answers.startWeight, oninput: (e) => { answers.startWeight = e.target.value; } }), err("startWeight")]),
          h("label", {}, ["Goal weight (kg)", h("input", { type: "text", inputmode: "decimal", id: "ob-goal", placeholder: "e.g. 70", value: answers.goalWeight, oninput: (e) => { answers.goalWeight = e.target.value; } }), err("goalWeight")]),
        ]),
      ];
    }
    return [
      h("h2", { id: "ob-title" }, "Reminders"),
      h("p", { class: "muted" }, "Get a notification 2 minutes before each unchecked item while the app is open or running in the background."),
      remindersSupported()
        ? h("label", { class: "ob-check" }, [h("input", { type: "checkbox", id: "ob-reminders", checked: answers.reminders ? "checked" : null, onchange: (e) => { answers.reminders = e.target.checked; } }), "Turn reminders on (your browser will ask permission)"])
        : h("p", { class: "muted" }, "This browser doesn't support notifications. On iPhone, add the app to the Home Screen first."),
    ];
  }

  function paint() {
    dialog.textContent = "";
    const last = step === STEPS.length - 1;
    dialog.append(
      h("div", { class: "ob-progress", "aria-label": `Step ${step + 1} of ${STEPS.length}` }, STEPS.map((_, i) => h("span", { class: `ob-dot${i === step ? " on" : i < step ? " past" : ""}` }))),
      ...body().filter(Boolean),
      h("div", { class: "ob-actions" }, [
        h("button", { type: "button", class: "link-btn", id: "ob-skip", onclick: () => close() }, "Skip setup"),
        step > 0 ? h("button", { type: "button", class: "secondary", id: "ob-back", onclick: () => { errors = {}; step--; paint(); } }, "Back") : null,
        h("button", {
          type: "button", class: "primary", id: "ob-next",
          onclick: () => {
            if (last) { finish(); return; }
            errors = validateStep(STEPS[step], answers);
            if (Object.keys(errors).length) { paint(); return; }
            step++;
            paint();
          },
        }, last ? "Finish" : "Next"),
      ]),
    );
    // Focus the first error or the first control.
    (dialog.querySelector(".ob-err")?.closest("label")?.querySelector("input") || dialog.querySelector("input") || dialog.querySelector("#ob-next"))?.focus();
  }
  paint();
}

/** About-tab card to re-run the setup. */
export function setupCard(rerender) {
  return h("div", { class: "card", id: "setup-card" }, [
    h("h2", {}, "Setup"),
    h("p", { class: "muted" }, "Walk through the first-run questions again: meal times, workout days, weight and reminders."),
    h("button", { type: "button", class: "secondary", id: "rerun-setup", onclick: () => openOnboarding(rerender) }, "Re-run setup"),
  ]);
}
