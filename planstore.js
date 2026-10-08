// Plan overrides layered on top of the program defaults in data.js.
// Stored in localStorage under 'elevate-planner:plan' (so backups include it).
// Everything except loadPlan/savePlan/clearPlan is pure and storage-free.
//
// Plan shape (all parts optional):
//   meals:       { "YYYY-MM-DD": { breakfast: "text", ... } }  per-date meal swaps
//   off:         [{ from, to, label }]                           off-day / vacation ranges
//   workoutDays: [0..6] | null                                   null = WORKOUT.days from data.js
//   times:       { wake: "06:15", ... }                          edited default times

import { DEFAULT_TIMES, MENUS, WORKOUT } from "./data.js";

export const PLAN_KEY = "elevate-planner:plan";
export const MEAL_SLOTS = ["earlyMorning", "breakfast", "lunch", "snack", "dinner"];
export const SLOT_LABELS = { earlyMorning: "Early morning", breakfast: "Breakfast", lunch: "Lunch", snack: "Snack", dinner: "Dinner" };
export const DEFAULT_OFF_LABEL = "Off day";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function dateKeyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function emptyPlan() {
  return { meals: {}, off: [], workoutDays: null, times: {} };
}

/** Sanitise any value into a well-formed plan (never throws). */
export function normalizePlan(raw) {
  const plan = emptyPlan();
  if (!raw || typeof raw !== "object") return plan;
  if (raw.meals && typeof raw.meals === "object") {
    for (const [date, slots] of Object.entries(raw.meals)) {
      if (!DATE_RE.test(date) || !slots || typeof slots !== "object") continue;
      for (const slot of MEAL_SLOTS) {
        const text = typeof slots[slot] === "string" ? slots[slot].trim().slice(0, 300) : "";
        if (text) (plan.meals[date] ||= {})[slot] = text;
      }
    }
  }
  if (Array.isArray(raw.off)) {
    for (const r of raw.off) {
      if (!r || !DATE_RE.test(r.from)) continue;
      let from = r.from;
      let to = DATE_RE.test(r.to) ? r.to : r.from;
      if (to < from) [from, to] = [to, from];
      const label = typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 60) : DEFAULT_OFF_LABEL;
      plan.off.push({ from, to, label });
    }
  }
  if (Array.isArray(raw.workoutDays)) {
    plan.workoutDays = [...new Set(raw.workoutDays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
  }
  if (raw.times && typeof raw.times === "object") {
    for (const k of Object.keys(DEFAULT_TIMES)) if (typeof raw.times[k] === "string" && TIME_RE.test(raw.times[k])) plan.times[k] = raw.times[k];
  }
  return plan;
}

export function isEmptyPlan(plan) {
  const p = normalizePlan(plan);
  return !Object.keys(p.meals).length && !p.off.length && p.workoutDays === null && !Object.keys(p.times).length;
}

// ---- storage ----
export function loadPlan() {
  try {
    const raw = globalThis.localStorage?.getItem(PLAN_KEY);
    return normalizePlan(raw ? JSON.parse(raw) : null);
  } catch {
    return emptyPlan();
  }
}

export function savePlan(plan) {
  try {
    const p = normalizePlan(plan);
    if (isEmptyPlan(p)) localStorage.removeItem(PLAN_KEY);
    else localStorage.setItem(PLAN_KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

export function clearPlan() {
  try { localStorage.removeItem(PLAN_KEY); } catch { /* ignore */ }
}

// ---- pure queries ----
/** The off-day range covering `key` ("YYYY-MM-DD"), or null. Later ranges win. */
export function offDayFor(plan, key) {
  const p = normalizePlan(plan);
  for (let i = p.off.length - 1; i >= 0; i--) if (key >= p.off[i].from && key <= p.off[i].to) return p.off[i];
  return null;
}

export function effectiveWorkoutDays(plan) {
  return normalizePlan(plan).workoutDays ?? WORKOUT.days;
}

export function effectiveTimes(plan = loadPlan()) {
  return { ...DEFAULT_TIMES, ...normalizePlan(plan).times };
}

/** Meal text for a slot on a date, honouring a swap. */
export function mealFor(plan, key, slot, weekday) {
  return normalizePlan(plan).meals[key]?.[slot] || MENUS[slot][weekday];
}

/** Distinct menu entries for a slot across the week: [{ text, weekdays: [..] }]. */
export function menuOptions(slot) {
  const map = new Map();
  MENUS[slot].forEach((text, wd) => {
    if (!map.has(text)) map.set(text, []);
    map.get(text).push(wd);
  });
  return [...map].map(([text, weekdays]) => ({ text, weekdays }));
}

// ---- pure updates (return a new normalised plan) ----
export function setMealOverride(plan, key, slot, text) {
  const p = normalizePlan(plan);
  if (!DATE_RE.test(key) || !MEAL_SLOTS.includes(slot)) return p;
  const t = typeof text === "string" ? text.trim() : "";
  if (t) (p.meals[key] ||= {})[slot] = t;
  else if (p.meals[key]) {
    delete p.meals[key][slot];
    if (!Object.keys(p.meals[key]).length) delete p.meals[key];
  }
  return normalizePlan(p);
}

export function addOffRange(plan, from, to, label) {
  const p = normalizePlan(plan);
  if (!DATE_RE.test(from)) return p;
  p.off.push({ from, to: to || from, label });
  p.off = normalizePlan(p).off.sort((a, b) => a.from.localeCompare(b.from));
  return p;
}

export function removeOffRange(plan, index) {
  const p = normalizePlan(plan);
  p.off.splice(index, 1);
  return p;
}

/** days: array of weekdays, or null to go back to the program default. */
export function setWorkoutDays(plan, days) {
  const p = normalizePlan(plan);
  return normalizePlan({ ...p, workoutDays: days === null ? null : days });
}

/** value null/"" removes the edit for that field. */
export function setDefaultTime(plan, field, value) {
  const p = normalizePlan(plan);
  if (!(field in DEFAULT_TIMES)) return p;
  if (value && TIME_RE.test(value) && value !== DEFAULT_TIMES[field]) p.times[field] = value;
  else delete p.times[field];
  return p;
}

// ---- per-day meal notes (text only) ----
export const MEALNOTES_KEY = "elevate-planner:mealnotes";

function readNotes() {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(MEALNOTES_KEY) || "null");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function getMealNote(key, slot) {
  const v = readNotes()[key]?.[slot];
  return typeof v === "string" ? v : "";
}

export function setMealNote(key, slot, text) {
  try {
    const all = readNotes();
    const t = String(text ?? "").trim().slice(0, 500);
    if (t) (all[key] ||= {})[slot] = t;
    else if (all[key]) {
      delete all[key][slot];
      if (!Object.keys(all[key]).length) delete all[key];
    }
    if (Object.keys(all).length) localStorage.setItem(MEALNOTES_KEY, JSON.stringify(all));
    else localStorage.removeItem(MEALNOTES_KEY);
    return true;
  } catch {
    return false;
  }
}
