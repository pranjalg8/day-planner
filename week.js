import { ACTIONS } from "./data.js";
import { dailyMedActive, weeklyMedActiveToday } from "./engine.js";
import { dateKey } from "./logstore.js";
import { loadPlan, mealFor, effectiveWorkoutDays, offDayFor } from "./planstore.js";

const SLOTS = { "Early AM": "earlyMorning", Breakfast: "breakfast", Lunch: "lunch", Snack: "snack", Dinner: "dinner" };
const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function h(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}

// Monday-first week containing `now`.
export function weekDates(now = new Date()) {
  const mondayOffset = (now.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset + i));
}

export function renderWeekTab() {
  const now = new Date();
  const todayKey = dateKey(now);
  const wrap = h("div", {});
  const plan = loadPlan();
  for (const d of weekDates(now)) {
    const wd = d.getDay();
    const isToday = dateKey(d) === todayKey;
    const markers = [];
    const off = offDayFor(plan, dateKey(d));
    if (off) markers.push(h("span", { class: "chip wk-off" }, `🌴 ${off.label}`));
    else if (effectiveWorkoutDays(plan).includes(wd)) markers.push(h("span", { class: "chip wk-workout" }, "🏋️ Workout"));
    if (weeklyMedActiveToday(d)) markers.push(h("span", { class: "chip wk-d3" }, "💊 D3 day"));
    else if (dailyMedActive(d)) markers.push(h("span", { class: "chip wk-meds" }, "💊 Meds"));
    const meal = (label) => h("div", { class: "wk-meal" }, [h("span", { class: "wk-meal-l" }, label), h("span", {}, mealFor(plan, dateKey(d), SLOTS[label], wd))]);
    wrap.appendChild(h("div", { class: `card wk-day${isToday ? " today" : ""}`, "data-date": dateKey(d), "aria-current": isToday ? "date" : null }, [
      h("div", { class: "wk-head" }, [
        h("h2", {}, `${NAMES[wd]} ${d.getDate()}/${d.getMonth() + 1}`),
        isToday ? h("span", { class: "chip wk-today" }, "Today") : null,
      ]),
      h("div", { class: "wk-markers" }, markers),
      meal("Early AM"),
      meal("Breakfast"),
      meal("Lunch"),
      meal("Snack"),
      meal("Dinner"),
    ]));
  }
  wrap.appendChild(h("div", { class: "card" }, [
    h("h2", {}, "Daily targets"),
    h("div", {}, `Water: ${ACTIONS.waterTargetLitres}L/day`),
    h("div", {}, `Steps: ${ACTIONS.stepTarget}/day`),
    h("div", {}, `Walking: ${ACTIONS.walkTargetMin} min/day (covered by 3× ${ACTIONS.walkAfterMealMin}-min post-meal walks)`),
    h("div", {}, `Cucumber: ${ACTIONS.cucumberSlices} slices to start breakfast, lunch, and dinner`),
  ]));
  return wrap;
}
