// Pure logic for the weekly review: which week to review, whether to nudge,
// and the summary text. No DOM, no storage (callers pass data in).

import { GROUPS, WEEKDAY_NAMES, rangeStats, summarize, parseKey, dateKey } from "./insightsdata.js";

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const weekStartOf = (d) => addDays(d, -((d.getDay() + 6) % 7));

/** The week to review: this week on Sunday, otherwise the week that just ended. */
export function reviewWeekFor(today) {
  const ws = weekStartOf(today);
  return today.getDay() === 0 ? ws : addDays(ws, -7);
}

/**
 * Nudge on Sunday, Monday and Tuesday until the user has seen that week's review.
 * The week must have started on/after the plan, and have at least one tracked day.
 */
export function isReviewDue(today, seenWeekKey, planStart) {
  if (today.getDay() > 2) return false;
  const ws = reviewWeekFor(today);
  const key = dateKey(ws);
  if (seenWeekKey === key) return false;
  return dateKey(addDays(ws, 6)) >= planStart;
}

// One cautious, practical tip per area. No medical claims.
const TIPS = {
  meals: ["Meals", "Tick meals right after eating, or use Catch up in the evening. A quick tick keeps the record honest."],
  medicines: ["Medicines", "Missed doses are the ones to look at first. Check that reminders are on, and ask your doctor what to do about missed doses."],
  workout: ["Workout", "Pick two fixed workout days and protect them. A shorter session still counts."],
  water: ["Water", "Add a glass with each meal, so you hit most of the day's glasses without thinking about it."],
  walks: ["Walks", "Start with just the walk after dinner, then add the others once that feels automatic."],
  measure: ["Weigh-in", "Weigh at the same moment each morning, right after waking, so the trend means something."],
};

/**
 * Review for the week starting `weekStart` (a Monday). `today` clips the range
 * so an in-progress week only counts days up to today.
 */
export function buildReview(data, weekStart, today = new Date()) {
  const end = addDays(weekStart, 6);
  const clippedEnd = dateKey(end) > dateKey(today) ? today : end;
  const stats = rangeStats(weekStart, clippedEnd, data, today);
  const prevStats = rangeStats(addDays(weekStart, -7), addDays(weekStart, -1), data, today);
  const cur = summarize(stats, data.log);
  const prev = summarize(prevStats, data.log);

  const groups = GROUPS.map((g) => ({ id: g.id, label: g.label, ...cur.groups[g.id], prevPct: prev.groups[g.id].pct })).filter((g) => g.total > 0);
  const delta = cur.overall != null && prev.overall != null ? Math.round((cur.overall - prev.overall) * 100) : null;

  // Strongest / weakest day (needs at least 3 tracked days to mean anything).
  let bestDay = null, worstDay = null;
  if (stats.length >= 3) {
    const sorted = [...stats].sort((a, b) => b.ratio - a.ratio);
    if (sorted[0].ratio > sorted[sorted.length - 1].ratio) {
      bestDay = { name: WEEKDAY_NAMES[sorted[0].date.getDay()], pct: sorted[0].ratio };
      worstDay = { name: WEEKDAY_NAMES[sorted[sorted.length - 1].date.getDay()], pct: sorted[sorted.length - 1].ratio };
    }
  }

  const workoutDays = stats.filter((s) => s.workoutDone).length;
  const wins = [];
  if (delta != null && delta > 0) wins.push(`Up ${delta} point${delta === 1 ? "" : "s"} on last week overall.`);
  for (const g of groups) if (g.pct != null && g.pct >= 0.9) wins.push(`${g.label}: ${Math.round(g.pct * 100)}% done.`);
  if (workoutDays > 0) wins.push(`${workoutDays} workout day${workoutDays === 1 ? "" : "s"} completed.`);
  if (cur.litres > 0) wins.push(`${cur.litres.toFixed(1)} L of water logged.`);

  const weak = groups.filter((g) => g.pct != null).sort((a, b) => a.pct - b.pct)[0] || null;
  let suggestion;
  if (!stats.length || cur.overall == null) suggestion = { title: "No data yet", text: "Tick items on Today during the week and your review will fill in." };
  else if (weak && weak.pct < 0.8) suggestion = { title: `Focus: ${TIPS[weak.id][0]} (${Math.round(weak.pct * 100)}%)`, text: TIPS[weak.id][1] };
  else suggestion = { title: "Steady week", text: "Everything is at or above 80%. Keep the routine as it is." };

  return {
    weekStart: dateKey(weekStart),
    weekEnd: dateKey(end),
    days: stats.length,
    complete: dateKey(end) <= dateKey(today),
    overall: cur.overall,
    prevOverall: prev.overall,
    delta,
    groups,
    bestDay,
    worstDay,
    workoutDays,
    litres: cur.litres,
    avgSteps: cur.avgSteps,
    weightChange: cur.weightChange,
    wins,
    suggestion,
  };
}

export { parseKey, dateKey };
