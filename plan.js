// Plan tab: in-app overrides on top of the program defaults (data.js).
import { DEFAULT_TIMES, WORKOUT } from "./data.js";
import {
  MEAL_SLOTS, SLOT_LABELS, loadPlan, savePlan, clearPlan, isEmptyPlan, menuOptions, mealFor, dateKeyOf,
  setMealOverride, addOffRange, removeOffRange, setWorkoutDays, setDefaultTime, getMealNote, setMealNote,
} from "./planstore.js";
import { groceryCard } from "./grocery.js";
import { programCard } from "./programcard.js";
import { el as h } from "./dom.js";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIME_LABELS = {
  wake: "Wake", earlyMorning: "Early morning", workout: "Workout", breakfast: "Breakfast", lunch: "Lunch",
  snack: "Snack", stretch: "Stretching", dinner: "Dinner", bedtime: "Bedtime",
};
// Today-tab meal item ids -> plan slots.
const ITEM_SLOT = { "early-morning": "earlyMorning", breakfast: "breakfast", lunch: "lunch", snack: "snack", dinner: "dinner" };

/**
 * Per-day meal note (text only) for a Today meal item. Returns a small DOM
 * node for meal items (early-morning, breakfast, lunch, snack, dinner) and
 * null for everything else, so renderToday can call it for every item:
 *   mealNoteWidget(key, item.id)
 */
export function mealNoteWidget(dateKey, itemId) {
  const slot = ITEM_SLOT[itemId];
  if (!slot) return null;
  const wrap = h("div", { class: "meal-note", "data-slot": slot });
  const show = () => {
    wrap.textContent = "";
    const note = getMealNote(dateKey, slot);
    if (note) wrap.appendChild(h("div", { class: "meal-note-text" }, `📝 ${note}`));
    wrap.appendChild(h("button", { class: "link-btn", type: "button", onclick: edit, "aria-label": `${note ? "Edit" : "Add"} note for ${SLOT_LABELS[slot]}` }, note ? "Edit note" : "+ Note"));
  };
  const edit = () => {
    wrap.textContent = "";
    const input = h("input", { type: "text", class: "meal-note-input", maxlength: "500", placeholder: "How did it go? Swaps, portions, cravings…", "aria-label": `Note for ${SLOT_LABELS[slot]}`, value: getMealNote(dateKey, slot) });
    const save = () => { setMealNote(dateKey, slot, input.value); show(); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
    wrap.append(input, h("button", { class: "secondary", type: "button", onclick: save }, "Save"));
    input.focus();
  };
  show();
  return wrap;
}

let swapDraft = { date: dateKeyOf(new Date()), slot: "breakfast", choice: "", custom: "" };

export function renderPlanTab(rerender) {
  const plan = loadPlan();
  const commit = (next) => { savePlan(next); rerender(); };
  const wrap = document.createDocumentFragment();

  wrap.appendChild(h("div", { class: "card plan-intro" }, [
    h("h2", {}, "Plan"),
    h("p", { class: "muted" }, "Adjust the program for real life. Changes layer on top of the defaults in the app and are saved on this device (included in your backup)."),
    isEmptyPlan(plan) ? h("span", { class: "chip" }, "Using program defaults") : h("span", { class: "chip plan-custom" }, "Custom plan active"),
  ]));

  // ---- Swap a meal ----
  const swapCard = h("div", { class: "card", id: "plan-swap" }, [h("h2", {}, "Swap a meal")]);
  const dateInput = h("input", { type: "date", id: "swap-date", value: swapDraft.date, onchange: (e) => { swapDraft.date = e.target.value; rerender(); } });
  const slotSel = h("select", { id: "swap-slot", onchange: (e) => { swapDraft.slot = e.target.value; swapDraft.choice = ""; rerender(); } },
    MEAL_SLOTS.map((s) => h("option", { value: s, selected: s === swapDraft.slot ? "selected" : null }, SLOT_LABELS[s])));
  const opts = menuOptions(swapDraft.slot);
  const choiceSel = h("select", { id: "swap-choice", onchange: (e) => { swapDraft.choice = e.target.value; rerender(); } }, [
    h("option", { value: "" }, "Pick from the menu…"),
    ...opts.map((o, i) => h("option", { value: String(i), selected: swapDraft.choice === String(i) ? "selected" : null }, `${o.weekdays.map((d) => DAY_SHORT[d]).join("/")}: ${o.text.slice(0, 60)}`)),
    h("option", { value: "custom", selected: swapDraft.choice === "custom" ? "selected" : null }, "Custom text…"),
  ]);
  const customInput = h("input", { type: "text", id: "swap-custom", placeholder: "e.g. Restaurant: grilled fish + salad", maxlength: "300", value: swapDraft.custom, oninput: (e) => { swapDraft.custom = e.target.value; } });
  const dayWd = swapDraft.date ? new Date(swapDraft.date + "T12:00:00").getDay() : 0;
  swapCard.append(
    h("div", { class: "plan-form" }, [
      h("label", {}, ["Date", dateInput]),
      h("label", {}, ["Meal", slotSel]),
      h("label", {}, ["Replace with", choiceSel]),
      swapDraft.choice === "custom" ? h("label", {}, ["Your text", customInput]) : null,
    ]),
    swapDraft.date ? h("p", { class: "muted" }, `Currently: ${mealFor(plan, swapDraft.date, swapDraft.slot, dayWd)}`) : null,
    h("div", { class: "actions-row" }, [
      h("button", {
        class: "primary", id: "swap-apply",
        onclick: () => {
          let text = "";
          if (swapDraft.choice === "custom") text = swapDraft.custom.trim();
          else if (swapDraft.choice !== "") text = opts[Number(swapDraft.choice)]?.text || "";
          if (!swapDraft.date || !text) { alert("Pick a date and a meal (or type your own)."); return; }
          swapDraft.choice = ""; swapDraft.custom = "";
          commit(setMealOverride(plan, swapDraft.date, swapDraft.slot, text));
        },
      }, "Apply swap"),
    ]),
  );
  const swaps = Object.entries(plan.meals).flatMap(([date, slots]) => Object.entries(slots).map(([slot, text]) => ({ date, slot, text }))).sort((a, b) => a.date.localeCompare(b.date));
  if (swaps.length) {
    swapCard.appendChild(h("h3", { class: "grocery-sub" }, "Active swaps"));
    swapCard.appendChild(h("ul", { class: "plan-list", id: "swap-list" }, swaps.map((s) =>
      h("li", {}, [
        h("div", {}, [h("strong", {}, `${s.date} · ${SLOT_LABELS[s.slot]}`), h("div", { class: "muted" }, s.text)]),
        h("button", { class: "secondary", "aria-label": `Remove swap ${s.date} ${SLOT_LABELS[s.slot]}`, onclick: () => commit(setMealOverride(plan, s.date, s.slot, null)) }, "Remove"),
      ]))));
  }
  wrap.appendChild(swapCard);

  // ---- Off days ----
  const today = dateKeyOf(new Date());
  const fromIn = h("input", { type: "date", id: "off-from", value: today });
  const toIn = h("input", { type: "date", id: "off-to", value: today });
  const labelIn = h("input", { type: "text", id: "off-label", placeholder: "Off day / Vacation", maxlength: "60" });
  const offCard = h("div", { class: "card", id: "plan-off" }, [
    h("h2", {}, "Off day / vacation"),
    h("p", { class: "muted" }, "Hides workouts, stretching and post-meal walks for those dates. Medicines and meals stay."),
    h("div", { class: "plan-form" }, [h("label", {}, ["From", fromIn]), h("label", {}, ["To", toIn]), h("label", {}, ["Label", labelIn])]),
    h("div", { class: "actions-row" }, [
      h("button", {
        class: "primary", id: "off-add",
        onclick: () => {
          if (!fromIn.value) { alert("Pick a start date."); return; }
          commit(addOffRange(plan, fromIn.value, toIn.value || fromIn.value, labelIn.value.trim() || "Off day"));
        },
      }, "Add off days"),
    ]),
  ]);
  if (plan.off.length) {
    offCard.appendChild(h("ul", { class: "plan-list", id: "off-list" }, plan.off.map((r, i) =>
      h("li", {}, [
        h("div", {}, [h("strong", {}, `🌴 ${r.label}`), h("div", { class: "muted" }, r.from === r.to ? r.from : `${r.from} → ${r.to}`)]),
        h("button", { class: "secondary", "aria-label": `Remove ${r.label} ${r.from}`, onclick: () => commit(removeOffRange(plan, i)) }, "Remove"),
      ]))));
  }
  wrap.appendChild(offCard);

  // ---- Workout weekdays ----
  const days = plan.workoutDays ?? WORKOUT.days;
  const wkCard = h("div", { class: "card", id: "plan-workout" }, [
    h("h2", {}, "Workout days"),
    h("p", { class: "muted" }, "Which weekdays get the morning circuit and evening stretching."),
    h("div", { class: "day-toggles", role: "group", "aria-label": "Workout weekdays" }, DAY_SHORT.map((name, wd) =>
      h("label", { class: `day-toggle${days.includes(wd) ? " on" : ""}` }, [
        h("input", {
          type: "checkbox", "data-wd": String(wd), checked: days.includes(wd) ? "checked" : null,
          onchange: (e) => commit(setWorkoutDays(plan, e.target.checked ? [...days, wd] : days.filter((d) => d !== wd))),
        }),
        h("span", {}, name),
      ]))),
    h("div", { class: "actions-row" }, [
      plan.workoutDays ? h("button", { class: "secondary", onclick: () => commit(setWorkoutDays(plan, null)) }, "Back to program default") : null,
      h("button", { class: "secondary", id: "plan-open-workout", type: "button", onclick: () => document.dispatchEvent(new CustomEvent("planner:tab", { detail: "workout" })) }, "View workout routine"),
    ]),
  ]);
  wrap.appendChild(wkCard);

  // ---- Default times ----
  const times = { ...DEFAULT_TIMES, ...plan.times };
  wrap.appendChild(h("div", { class: "card", id: "plan-times" }, [
    h("h2", {}, "Default times"),
    h("p", { class: "muted" }, "Your usual times. You can still adjust any single day from Today."),
    h("div", { class: "row" }, Object.keys(DEFAULT_TIMES).map((f) =>
      h("label", { class: "time-field" }, [
        TIME_LABELS[f] || f,
        h("input", { type: "time", "data-field": f, value: times[f], onchange: (e) => commit(setDefaultTime(plan, f, e.target.value)) }),
      ]))),
    Object.keys(plan.times).length ? h("div", { class: "actions-row" }, [h("button", { class: "secondary", onclick: () => commit({ ...plan, times: {} }) }, "Reset times")]) : null,
  ]));

  wrap.appendChild(programCard(rerender));

  wrap.appendChild(groceryCard(rerender));

  // ---- Reset ----
  wrap.appendChild(h("div", { class: "card", id: "plan-reset" }, [
    h("h2", {}, "Reset"),
    h("p", { class: "muted" }, "Removes all swaps, off days, workout-day, default-time and program-date changes. Checked items, logs and meal notes are kept."),
    h("button", {
      class: "secondary", id: "plan-reset-btn", disabled: isEmptyPlan(plan) ? "disabled" : null,
      onclick: () => { if (confirm("Reset the plan to program defaults?")) { clearPlan(); rerender(); } },
    }, "Reset to program defaults"),
  ]));

  return wrap;
}
