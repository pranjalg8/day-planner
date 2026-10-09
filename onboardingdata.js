// Pure logic for the first-run setup flow. No DOM, no storage: the UI in
// onboarding.js collects answers and calls these to validate and to turn the
// answers into plan edits.
import { setDefaultTime, setWorkoutDays } from "./planstore.js";

/** Not prefixed with "elevate-planner:", so backups neither export nor restore it
 *  (restoring someone else's backup must not re-trigger or suppress the setup). */
export const ONBOARDED_KEY = "elevate-planner-onboarded";

export const STEPS = ["times", "workout", "weight", "reminders"];
export const TIME_FIELDS = ["wake", "breakfast", "lunch", "dinner"];
export const TIME_LABELS = { wake: "Wake up", breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const WEIGHT_MIN = 20;
const WEIGHT_MAX = 400; // same bounds as the Insights goal input
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "72.5" / "72,5" / 72.5 -> 72.5, "" -> null (not given), junk or out of range -> NaN. */
export function parseWeight(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= WEIGHT_MIN && n <= WEIGHT_MAX ? Math.round(n * 10) / 10 : NaN;
}

/** Validate one step's answers. Returns { field: message } (empty = fine). */
export function validateStep(step, a) {
  const errors = {};
  if (step === "times") {
    for (const f of TIME_FIELDS) if (!TIME_RE.test(a.times?.[f] || "")) errors[f] = `${TIME_LABELS[f]}: enter a time.`;
    if (!Object.keys(errors).length) {
      const t = a.times;
      if (!(t.wake < t.breakfast && t.breakfast < t.lunch && t.lunch < t.dinner)) {
        errors.times = "Meals should follow the order wake, breakfast, lunch, dinner.";
      }
    }
  } else if (step === "workout") {
    const d = a.workoutDays;
    if (!Array.isArray(d) || d.some((n) => !Number.isInteger(n) || n < 0 || n > 6)) errors.workoutDays = "Pick the days you want to work out.";
  } else if (step === "weight") {
    const w = parseWeight(a.startWeight);
    const g = parseWeight(a.goalWeight);
    if (Number.isNaN(w)) errors.startWeight = `Starting weight: enter ${WEIGHT_MIN} to ${WEIGHT_MAX} kg, or leave it blank.`;
    if (Number.isNaN(g)) errors.goalWeight = `Goal weight: enter ${WEIGHT_MIN} to ${WEIGHT_MAX} kg, or leave it blank.`;
    if (!errors.startWeight && !errors.goalWeight && w !== null && g !== null && w === g) errors.goalWeight = "Goal weight is the same as your starting weight.";
  }
  return errors;
}

export function validateAll(a) {
  return STEPS.reduce((acc, s) => ({ ...acc, ...validateStep(s, a) }), {});
}

/**
 * Pure: apply times and workout days to a plan (returns a new plan).
 * An empty workout selection is allowed (no workout days).
 */
export function applyToPlan(plan, a) {
  let p = plan;
  for (const f of TIME_FIELDS) if (a.times?.[f]) p = setDefaultTime(p, f, a.times[f]);
  if (Array.isArray(a.workoutDays)) p = setWorkoutDays(p, a.workoutDays);
  return p;
}

/** Non-plan side effects as data, so the UI layer stays thin: weight/goal numbers or null. */
export function sideEffects(a) {
  const w = parseWeight(a.startWeight);
  const g = parseWeight(a.goalWeight);
  return { startWeight: Number.isNaN(w) ? null : w, goalWeight: Number.isNaN(g) ? null : g, reminders: !!a.reminders };
}
