// Pure scheduling logic: turns the static plan (data.js) + a day's actual
// times into an ordered list of timed items. No DOM, no storage — easy to
// reason about and to re-run whenever an actual time changes.

import { PROGRAM, DEFAULT_TIMES, MEDICINES, ACTIONS, MENUS, WORKOUT, PREP_NOTES } from "./data.js";
import { loadPlan, normalizePlan, offDayFor, dateKeyOf } from "./planstore.js";

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function toHHMM(mins) {
  const wrapped = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function daysBetween(aISO, bDate) {
  const a = new Date(aISO + "T00:00:00");
  const b = new Date(bDate.getFullYear(), bDate.getMonth(), bDate.getDate());
  return Math.round((b - a) / 86400000);
}

export function planDayNumber(dateObj) {
  const n = daysBetween(PROGRAM.planStart, dateObj) + 1;
  return n >= 1 ? n : null;
}

export function dailyMedDayNumber(dateObj) {
  const n = daysBetween(PROGRAM.dailyMedsCourseStart, dateObj) + 1;
  return n;
}

export function dailyMedActive(dateObj) {
  const n = dailyMedDayNumber(dateObj);
  return n >= 1 && n <= PROGRAM.dailyMedsCourseDays;
}

export function weeklyMedActiveToday(dateObj) {
  if (dateObj.getDay() !== PROGRAM.weeklyMedDayOfWeek) return false;
  const startDiff = daysBetween(PROGRAM.weeklyMedStart, dateObj);
  if (startDiff < 0) return false;
  const weekNumber = Math.floor(startDiff / 7) + 1;
  return weekNumber <= PROGRAM.weeklyMedCourseWeeks;
}

/**
 * Compute today's full schedule.
 * @param {Date} dateObj - the calendar day being planned.
 * @param {object} overrides - actual times keyed by slot name
 *   (wake, earlyMorning, breakfast, lunch, snack, dinner, bedtime), "HH:MM".
 * @param {Set<string>} doneIds - item ids already marked done (excluded
 *   from calendar export, kept in the on-screen list).
 * @param {object} [plan] - plan overrides (see planstore.js): meal swaps,
 *   off-day ranges, workout weekdays, default times. Defaults to the saved
 *   plan (an empty plan outside the browser); pass {} for pure program defaults.
 */
export function computeDay(dateObj, overrides = {}, doneIds = new Set(), plan = loadPlan()) {
  const weekday = dateObj.getDay();
  plan = normalizePlan(plan);
  const key = dateKeyOf(dateObj);
  const off = offDayFor(plan, key);
  const t = { ...DEFAULT_TIMES, ...plan.times, ...overrides };
  const mealText = (slot) => plan.meals[key]?.[slot] || MENUS[slot][weekday];

  const items = [];
  const push = (id, category, time, label, notes, links = [], durationMin = null) => {
    items.push({ id, category, time, minutes: toMinutes(time), label, notes, links, durationMin, done: doneIds.has(id) });
    return items[items.length - 1];
  };
  // A meal item whose text may have been swapped for this date.
  const meal = (slot, id, label) => {
    const it = push(id, "food", t[slot], label, mealText(slot));
    if (plan.meals[key]?.[slot]) it.swapped = true;
  };

  // Wake + weigh-in
  push(
    "wake-weigh", "measure", t.wake, "Weigh yourself (fasting)",
    "Before eating or drinking anything." + (off ? `\n🌴 ${off.label}: workouts and walks are hidden today.` : "")
  );

  // Early morning drink
  meal("earlyMorning", "early-morning", "Early morning drink");

  // Morning workout: warm-up, then each circuit exercise as its own item.
  const workoutToday = !off && (plan.workoutDays ?? WORKOUT.days).includes(weekday);
  if (workoutToday) {
    const workoutMin = toMinutes(t.workout);
    const w = WORKOUT.warmup;
    push("workout-warmup", "workout", t.workout, w.name, "Start of morning workout.", [{ name: w.name, url: w.url }], WORKOUT.warmupMin);
    let at = workoutMin + WORKOUT.warmupMin;
    WORKOUT.circuit.forEach((e, i) => {
      push(`workout-${i + 1}`, "workout", toHHMM(at), e.name, `${e.sets} sets × ${e.target}`, [{ name: e.name, url: e.url }], WORKOUT.exerciseMin);
      at += WORKOUT.exerciseMin;
    });
  }

  // Breakfast block
  const breakfastMin = toMinutes(t.breakfast);
  meal("breakfast", "breakfast", `Breakfast (start with ${ACTIONS.cucumberSlices} slices cucumber)`);
  if (!off) push("walk-breakfast", "exercise", toHHMM(breakfastMin + 5), `${ACTIONS.walkAfterMealMin}-min walk`, "Post-breakfast walk.");

  const dailyActive = dailyMedActive(dateObj);
  const stableAM = MEDICINES.find((m) => m.id === "stable-n-fit-am");
  const stableAMTime = breakfastMin + stableAM.offsetAfterMealMin;
  const clearEndAM = stableAMTime + stableAM.bufferAfterMin;
  if (dailyActive) {
    push(stableAM.id, "medicine", toHHMM(stableAMTime), stableAM.name, stableAM.notes);
  }
  for (const med of MEDICINES.filter((m) => m.dependsOnBuffer === "stable-n-fit-am")) {
    if (med.course === "daily" && !dailyActive) continue;
    push(med.id, "medicine", toHHMM(clearEndAM), med.name, med.notes);
  }

  // Lunch block
  const lunchMin = toMinutes(t.lunch);
  meal("lunch", "lunch", `Lunch (start with ${ACTIONS.cucumberSlices} slices cucumber)`);
  if (!off) push("walk-lunch", "exercise", toHHMM(lunchMin + 5), `${ACTIONS.walkAfterMealMin}-min walk`, "Post-lunch walk.");
  const evion = MEDICINES.find((m) => m.id === "evion-l-5000");
  if (dailyActive) {
    push(evion.id, "medicine", toHHMM(lunchMin + evion.offsetAfterMealMin), evion.name, evion.notes);
  }
  if (weeklyMedActiveToday(dateObj)) {
    const d3 = MEDICINES.find((m) => m.id === "uprise-d3-60k");
    push(d3.id, "medicine", toHHMM(lunchMin + d3.offsetAfterMealMin), d3.name, d3.notes);
  }

  // Snack
  meal("snack", "snack", "Evening snack");

  // Evening stretching
  if (workoutToday) {
    push("stretch", "workout", t.stretch, WORKOUT.stretch.name, "Evening stretching routine.", [
      { name: WORKOUT.stretch.name, url: WORKOUT.stretch.url },
    ]);
  }

  // Dinner block
  const dinnerMin = toMinutes(t.dinner);
  meal("dinner", "dinner", `Dinner (start with ${ACTIONS.cucumberSlices} slices cucumber)`);
  if (!off) push("walk-dinner", "exercise", toHHMM(dinnerMin + 5), `${ACTIONS.walkAfterMealMin}-min walk`, "Post-dinner walk.");

  const stablePM = MEDICINES.find((m) => m.id === "stable-n-fit-pm");
  const stablePMTime = dinnerMin + stablePM.offsetAfterMealMin;
  const clearEndPM = stablePMTime + stablePM.bufferAfterMin;
  if (dailyActive) {
    push(stablePM.id, "medicine", toHHMM(stablePMTime), stablePM.name, stablePM.notes);
  }
  for (const med of MEDICINES.filter((m) => m.dependsOnBuffer === "stable-n-fit-pm")) {
    if (med.course === "daily" && !dailyActive) continue;
    push(med.id, "medicine", toHHMM(clearEndPM), med.name, med.notes);
  }

  // Water checkpoints, evenly spaced between wake and bedtime.
  const wakeMin = toMinutes(t.wake);
  const bedMin = toMinutes(t.bedtime);
  const span = bedMin - wakeMin;
  const perCheckpoint = ACTIONS.waterTargetLitres / ACTIONS.waterCheckpoints;
  for (let i = 1; i <= ACTIONS.waterCheckpoints; i++) {
    const at = wakeMin + Math.round((span * i) / ACTIONS.waterCheckpoints);
    push(
      `water-${i}`,
      "water",
      toHHMM(at),
      `Water check-in: ~${(perCheckpoint * i).toFixed(1)}L down`,
      `Daily target ${ACTIONS.waterTargetLitres}L.`
    );
  }

  // Nightly prep for tomorrow.
  push("soak-almonds", "prep", toHHMM(bedMin - 30), "Soak almonds for tomorrow", "Before sleeping, every night.");

  // Evening prep for tomorrow's meals (e.g. soak dal). Skipped when tomorrow's
  // meal in that slot has been swapped, since the swap replaces the dish.
  const tomorrow = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate() + 1);
  const tomorrowPlanMeals = plan.meals[dateKeyOf(tomorrow)] || {};
  for (const p of PREP_NOTES) {
    if (p.weekday === tomorrow.getDay() && !tomorrowPlanMeals[p.slot]) {
      push(`prep-${p.id}`, "prep", toHHMM(bedMin - 40), p.label, p.notes);
    }
  }

  items.sort((a, b) => a.minutes - b.minutes);
  return items;
}
