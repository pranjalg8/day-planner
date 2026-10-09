// "Today at a glance": pure helpers (tested) + DOM builder for the Today tab.
import { ACTIONS, WORKOUT } from "./data.js";
import { getLog, setWeight, addWater, setSteps, setSetsDone, getTaken } from "./logstore.js";

export const GLASS_ML = 250;
export const FULL_SCHEDULE_PREF_KEY = "day-planner-ui:fullSchedule"; // UI pref, deliberately not backed up

export function glassTarget(litres = ACTIONS.waterTargetLitres) {
  return Math.ceil((litres * 1000) / GLASS_ML);
}

// Logging is allowed for today and past days, never the future.
export function logAllowed(key, todayKey) {
  return key <= todayKey;
}

export function setsProgress(sets, circuit = WORKOUT.circuit) {
  const total = circuit.reduce((a, e) => a + e.sets, 0);
  const done = circuit.reduce((a, e, i) => a + Math.min(e.sets, (sets && sets[i]) || 0), 0);
  return { done, total };
}

// First exercise index that still has sets to do, or -1 when the circuit is complete.
export function nextSetToLog(sets, circuit = WORKOUT.circuit) {
  return circuit.findIndex((e, i) => ((sets && sets[i]) || 0) < e.sets);
}

// New "sets done" count for an exercise after tapping tick number `setIdx` (0-based).
export function tapSetCount(currentDone, setIdx) {
  return setIdx < currentDone ? setIdx : setIdx + 1;
}

export function medsProgress(items, takenSet) {
  const doses = items.filter((i) => i.category === "medicine");
  return { done: doses.filter((d) => takenSet.has(d.id)).length, total: doses.length };
}

// The item to show in the "Next" tile: next upcoming today, else first unchecked item.
export function pickNextItem(items, isToday, nowMin) {
  const open = items.filter((i) => !i.done);
  if (isToday) return open.find((i) => i.minutes >= nowMin) || null;
  return open[0] || null;
}

export function glanceSummary({ key, items, nowMin, isToday }) {
  const log = getLog(key);
  const meds = medsProgress(items, getTaken(key));
  return {
    next: pickNextItem(items, isToday, nowMin),
    water: log.water,
    waterTarget: glassTarget(),
    steps: log.steps,
    stepTarget: ACTIONS.stepTarget,
    weight: log.weight,
    meds,
    sets: setsProgress(log.sets),
    setsMap: log.sets,
  };
}

export function readFullSchedulePref() {
  try { return localStorage.getItem(FULL_SCHEDULE_PREF_KEY) === "1"; } catch { return false; }
}
export function writeFullSchedulePref(open) {
  try { localStorage.setItem(FULL_SCHEDULE_PREF_KEY, open ? "1" : "0"); } catch { /* ignore */ }
}

// ---- DOM ----
function h(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}

/**
 * ctx: { key, todayKey, items, nowMin, isToday, goTab(tab), showNext(item), onChange? }
 * Logging re-renders only this card, preserving scroll and (by data-q) focus.
 */
export function buildGlance(ctx) {
  const { key, todayKey, isToday } = ctx;
  const allowed = logAllowed(key, todayKey);
  const s = glanceSummary(ctx);
  const dis = allowed ? null : "disabled";

  const refresh = (focusQ) => {
    const fresh = buildGlance(ctx);
    root.replaceWith(fresh);
    const t = focusQ && fresh.querySelector(`[data-q="${focusQ}"]`);
    if (t) t.focus({ preventScroll: true });
  };

  const tile = (id, label, value, sub, onclick, cls = "") =>
    h("button", { class: `gl-tile ${cls}`.trim(), type: "button", "data-tile": id, onclick, "aria-label": `${label}: ${value}${sub ? ", " + sub : ""}` }, [
      h("span", { class: "gl-label" }, label),
      h("span", { class: "gl-value" }, value),
      sub ? h("span", { class: "gl-sub" }, sub) : null,
    ]);

  const nextTile = s.next
    ? tile("next", isToday ? "Next up" : "First open", s.next.time, s.next.label, () => ctx.showNext(s.next), "gl-wide")
    : tile("next", isToday ? "Next up" : "Schedule", "All clear", isToday ? "Nothing left on the clock" : "Everything checked", () => ctx.showNext(null), "gl-wide");

  const grid = h("div", { class: "gl-grid" }, [
    nextTile,
    tile("water", "Water", `${s.water}/${s.waterTarget}`, "glasses", () => ctx.goTab("log")),
    tile("steps", "Steps", s.steps == null ? "—" : String(s.steps), `of ${s.stepTarget}`, () => ctx.goTab("log")),
    tile("weight", "Weight", s.weight == null ? "—" : `${s.weight} kg`, s.weight == null ? "not logged" : "logged", () => ctx.goTab("log")),
    tile("meds", "Meds", `${s.meds.done}/${s.meds.total}`, "doses taken", () => ctx.goTab("meds")),
    tile("sets", "Workout", `${s.sets.done}/${s.sets.total}`, "sets done", () => ctx.goTab("workout")),
  ]);

  const stepsInput = h("input", { type: "number", id: "gl-steps", inputmode: "numeric", min: "0", step: "1", placeholder: "steps", value: s.steps ?? "", disabled: dis, "aria-label": "Steps", "data-q": "steps-in" });
  const weightInput = h("input", { type: "number", id: "gl-weight", inputmode: "decimal", min: "20", max: "400", step: "0.1", placeholder: "kg", value: s.weight ?? "", disabled: dis, "aria-label": "Weight in kg", "data-q": "weight-in" });
  const saveSteps = () => { setSteps(key, stepsInput.value); refresh("steps-save"); };
  const saveWeight = () => { setWeight(key, weightInput.value); refresh("weight-save"); };
  stepsInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && allowed) saveSteps(); });
  weightInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && allowed) saveWeight(); });

  const nextEx = nextSetToLog(s.setsMap);
  const quick = h("details", { class: "gl-quick", open: "" }, [
    h("summary", {}, "Quick log"),
    allowed ? null : h("div", { class: "muted gl-hint", id: "gl-future-hint" }, "This is a future day. Logging opens on the day itself."),
    h("div", { class: "gl-row" }, [
      h("span", { class: "gl-row-label" }, `Water ${s.water}/${s.waterTarget}`),
      h("button", { class: "mini", type: "button", id: "gl-water-minus", "aria-label": "Remove a glass", disabled: allowed && s.water > 0 ? null : "disabled", "data-q": "water-minus", onclick: () => { addWater(key, -1); refresh("water-minus"); } }, "− glass"),
      h("button", { class: "mini primary", type: "button", id: "gl-water-plus", "aria-label": "Add a glass", disabled: dis, "data-q": "water-plus", onclick: () => { addWater(key, 1); refresh("water-plus"); } }, "+ glass"),
    ]),
    h("div", { class: "gl-row" }, [
      h("label", { class: "gl-row-label", for: "gl-steps" }, "Steps"),
      stepsInput,
      h("button", { class: "mini primary", type: "button", id: "gl-steps-save", disabled: dis, "data-q": "steps-save", onclick: saveSteps }, "Save"),
    ]),
    h("div", { class: "gl-row" }, [
      h("label", { class: "gl-row-label", for: "gl-weight" }, "Weight"),
      weightInput,
      h("button", { class: "mini primary", type: "button", id: "gl-weight-save", disabled: dis, "data-q": "weight-save", onclick: saveWeight }, "Save"),
    ]),
    h("div", { class: "gl-sets" }, [
      h("div", { class: "gl-sets-head" }, [
        h("span", { class: "gl-row-label" }, `Workout sets ${s.sets.done}/${s.sets.total}`),
        h("button", {
          class: "mini primary", type: "button", id: "gl-log-set", "data-q": "log-set",
          disabled: allowed && nextEx >= 0 ? null : "disabled",
          onclick: () => { if (nextEx >= 0) { setSetsDone(key, nextEx, ((s.setsMap[nextEx]) || 0) + 1); refresh("log-set"); } },
        }, nextEx >= 0 ? `Log a set: ${WORKOUT.circuit[nextEx].name}` : "Circuit complete"),
      ]),
      ...WORKOUT.circuit.map((e, i) => {
        const done = Math.min(e.sets, s.setsMap[i] || 0);
        return h("div", { class: "gl-ex" }, [
          h("span", { class: "gl-ex-name" }, e.name),
          h("span", { class: "gl-ticks" }, Array.from({ length: e.sets }, (_, n) =>
            h("button", {
              class: `gl-tick${n < done ? " on" : ""}`, type: "button", disabled: dis,
              "aria-pressed": n < done ? "true" : "false", "aria-label": `${e.name} set ${n + 1}`, "data-q": `tick-${i}-${n}`, "data-ex": String(i), "data-set": String(n),
              onclick: () => { setSetsDone(key, i, tapSetCount(done, n)); refresh(`tick-${i}-${n}`); },
            }, n < done ? "✓" : String(n + 1)))),
        ]);
      }),
    ]),
  ]);

  const root = h("div", { class: "card gl-card", id: "glance" }, [h("h2", {}, isToday ? "Today at a glance" : "Day at a glance"), grid, quick]);
  return root;
}
