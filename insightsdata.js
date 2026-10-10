// Pure aggregation for the Insights tab. No DOM. All functions take plain
// data (see readAll) so they can be tested without a browser.

import { ACTIONS, WORKOUT } from "./data.js";
import { computeDay } from "./engine.js";
import { effectiveProgram } from "./planstore.js";
import { STREAK_THRESHOLD } from "./progress.js";

const GOAL_KEY = "elevate-planner:goal";
const GLASS_L = 0.25;
// Display groups -> engine categories.
export const GROUPS = [
  { id: "meals", label: "Meals", cats: ["food"] },
  { id: "medicines", label: "Medicines", cats: ["medicine"] },
  { id: "workout", label: "Workout", cats: ["workout"] },
  { id: "water", label: "Water", cats: ["water"] },
  { id: "walks", label: "Walks", cats: ["exercise"] },
  { id: "measure", label: "Weigh-in", cats: ["measure"] },
];
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function parseKey(k) {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
/** Monday of the week containing d. */
function weekStart(d) {
  return addDays(d, -((d.getDay() + 6) % 7));
}

function readJSON(storage, key, fallback) {
  try {
    const v = JSON.parse(storage.getItem(key));
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Reads everything Insights needs from a Storage-like object. */
export function readAll(storage = globalThis.localStorage) {
  const days = {};
  const log = readJSON(storage, "elevate-planner:log", {});
  let goal = null;
  try {
    const g = Number(storage.getItem(GOAL_KEY));
    if (Number.isFinite(g) && g > 0) goal = g;
  } catch { /* ignore */ }
  for (let i = 0; ; i++) {
    let k;
    try { k = storage.key(i); } catch { break; }
    if (k == null) break;
    const m = /^elevate-planner:(\d{4}-\d{2}-\d{2})$/.exec(k);
    if (!m) continue;
    const s = readJSON(storage, k, {});
    days[m[1]] = { overrides: s.overrides || {}, done: Array.isArray(s.done) ? s.done : [] };
  }
  return { days, log, goal };
}

export function setGoal(kg, storage = globalThis.localStorage) {
  const n = Number(kg);
  try {
    if (Number.isFinite(n) && n > 0) storage.setItem(GOAL_KEY, String(n));
    else storage.removeItem(GOAL_KEY);
  } catch { /* ignore */ }
}

const pct = (done, total) => (total > 0 ? done / total : null);

/**
 * Per-day completion. Returns null for days before plan start or after today.
 * { key, done, total, ratio, byGroup: {id:{done,total}}, workoutDone }
 */
export function dayStats(date, data, today = new Date()) {
  const key = dateKey(date);
  if (key < effectiveProgram().planStart || key > dateKey(today)) return null;
  const st = data.days[key] || { overrides: {}, done: [] };
  const doneSet = new Set(st.done);
  const items = computeDay(date, st.overrides);
  const byGroup = {};
  for (const g of GROUPS) byGroup[g.id] = { done: 0, total: 0 };
  let done = 0;
  for (const it of items) {
    const isDone = doneSet.has(it.id);
    if (isDone) done++;
    const g = GROUPS.find((x) => x.cats.includes(it.category));
    if (g) {
      byGroup[g.id].total++;
      if (isDone) byGroup[g.id].done++;
    }
  }
  const total = items.length;
  const w = byGroup.workout;
  return { key, date, done, total, ratio: total ? done / total : 0, byGroup, hasState: !!data.days[key], workoutDone: w.total > 0 && w.done / w.total >= STREAK_THRESHOLD };
}

export function rangeStats(start, end, data, today = new Date()) {
  const out = [];
  for (let d = start; dateKey(d) <= dateKey(end); d = addDays(d, 1)) {
    const s = dayStats(d, data, today);
    if (s) out.push(s);
  }
  return out;
}

function logTotals(stats, log) {
  let litres = 0, sets = 0, stepSum = 0, stepDays = 0;
  for (const s of stats) {
    const e = log[s.key] || {};
    litres += (Number(e.water) || 0) * GLASS_L;
    if (typeof e.steps === "number") { stepSum += e.steps; stepDays++; }
    WORKOUT.circuit.forEach((ex, i) => { sets += Math.min(ex.sets, Number(e.sets?.[i]) || 0); });
  }
  return { litres, sets, avgSteps: stepDays ? Math.round(stepSum / stepDays) : null, stepDays };
}

/** Adherence per group + log totals for a list of day stats. */
export function summarize(stats, log = {}) {
  const groups = {};
  for (const g of GROUPS) {
    let d = 0, t = 0;
    for (const s of stats) { d += s.byGroup[g.id].done; t += s.byGroup[g.id].total; }
    groups[g.id] = { done: d, total: t, pct: pct(d, t) };
  }
  const done = stats.reduce((a, s) => a + s.done, 0);
  const total = stats.reduce((a, s) => a + s.total, 0);
  const wts = weightPoints(log).filter((p) => stats.some((s) => s.key === p.date));
  return {
    days: stats.length,
    overall: pct(done, total),
    groups,
    ...logTotals(stats, log),
    weightLatest: wts.length ? wts[wts.length - 1].kg : null,
    weightChange: wts.length > 1 ? wts[wts.length - 1].kg - wts[0].kg : null,
  };
}

/** This week (Mon..today) vs last week (Mon..Sun), both clipped to plan start. */
export function weeklySummary(data, today = new Date()) {
  const ws = weekStart(today);
  const lw = addDays(ws, -7);
  return {
    thisWeek: summarize(rangeStats(ws, today, data, today), data.log),
    lastWeek: summarize(rangeStats(lw, addDays(ws, -1), data, today), data.log),
  };
}

/** Heatmap grid: Monday-first columns for the last `weeks` weeks. */
export function heatmap(data, today = new Date(), weeks = 8) {
  const first = addDays(weekStart(today), -7 * (weeks - 1));
  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(first, w * 7 + i);
      const s = dayStats(d, data, today);
      col.push({ key: dateKey(d), date: d, ratio: s ? s.ratio : null, done: s?.done ?? 0, total: s?.total ?? 0 });
    }
    cols.push(col);
  }
  return cols;
}

/** Weight points oldest first: [{date, kg}] */
function weightPoints(log) {
  return Object.keys(log)
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && typeof log[k]?.weight === "number" && log[k].weight > 0)
    .sort()
    .map((k) => ({ date: k, kg: log[k].weight }));
}

/** Least-squares line over (day index, kg). slope in kg/day, or null. */
export function linearTrend(points) {
  if (points.length < 2) return null;
  const t0 = parseKey(points[0].date).getTime();
  const xs = points.map((p) => Math.round((parseKey(p.date).getTime() - t0) / 86400000));
  const n = points.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = points.reduce((a, p) => a + p.kg, 0) / n;
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (points[i].kg - my); den += (x - mx) ** 2; });
  if (den === 0) return null;
  const slope = num / den;
  return { slope, intercept: my - slope * mx, xs, t0, perWeek: slope * 7, at: (x) => my + slope * (x - mx) };
}

/** Cautious plain-language trend text. */
export function trendText(points, goal) {
  if (points.length === 0) return "No weigh-ins yet. Log your weight on the Log tab to see a trend.";
  if (points.length < 3) return "Log a few more weigh-ins to see a trend.";
  const tr = linearTrend(points);
  const latest = points[points.length - 1].kg;
  const pw = tr.perWeek;
  const dir = Math.abs(pw) < 0.05 ? "roughly steady" : pw < 0 ? `down about ${Math.abs(pw).toFixed(1)} kg per week` : `up about ${pw.toFixed(1)} kg per week`;
  let s = `Your trend is ${dir}.`;
  if (goal) {
    const diff = latest - goal;
    if (Math.abs(diff) < 0.1) s += " You are at your goal weight.";
    else if ((diff > 0 && pw < -0.05) || (diff < 0 && pw > 0.05)) {
      const weeks = Math.ceil(Math.abs(diff / pw));
      s += ` ${Math.abs(diff).toFixed(1)} kg to goal; at this pace that is roughly ${weeks} week${weeks === 1 ? "" : "s"}. This is only a rough estimate.`;
    } else s += ` ${Math.abs(diff).toFixed(1)} kg to goal; the recent trend is not heading that way yet.`;
  }
  return s;
}

/** Average completion per weekday over all eligible days. */
export function weekdayAverages(stats) {
  const acc = WEEKDAY_NAMES.map(() => ({ sum: 0, n: 0 }));
  for (const s of stats) { const a = acc[s.date.getDay()]; a.sum += s.ratio; a.n++; }
  const avgs = acc.map((a, i) => ({ day: i, name: WEEKDAY_NAMES[i], avg: a.n ? a.sum / a.n : null, n: a.n }));
  const ok = avgs.filter((a) => a.avg !== null && a.n >= 2);
  let best = null, worst = null;
  if (ok.length >= 2) {
    best = ok.reduce((a, b) => (b.avg > a.avg ? b : a));
    worst = ok.reduce((a, b) => (b.avg < a.avg ? b : a));
    if (best.avg === worst.avg) best = worst = null;
  }
  return { avgs, best, worst };
}

/** Current and best streaks of days at/above threshold. Today may be pending. */
export function streaks(stats, threshold = STREAK_THRESHOLD, today = new Date()) {
  const ok = stats.map((s) => s.ratio >= threshold);
  let best = 0, run = 0;
  for (const v of ok) { run = v ? run + 1 : 0; best = Math.max(best, run); }
  let i = stats.length - 1;
  if (i >= 0 && stats[i].key === dateKey(today) && !ok[i]) i--; // today still in progress
  let current = 0;
  while (i >= 0 && ok[i]) { current++; i--; }
  return { current, best };
}

/** Everything the tab shows. */
export function buildInsights(data, today = new Date()) {
  const all = rangeStats(parseKey(effectiveProgram().planStart), today, data, today);
  const totals = logTotals(all, data.log);
  return {
    hasData: all.length > 0 && (all.some((s) => s.done > 0) || Object.keys(data.log).length > 0),
    week: weeklySummary(data, today),
    heat: heatmap(data, today, 8),
    weights: weightPoints(data.log),
    goal: data.goal,
    weekdays: weekdayAverages(all),
    streaks: streaks(all, STREAK_THRESHOLD, today),
    totals: { workouts: all.filter((s) => s.workoutDone).length, sets: totals.sets, litres: totals.litres, days: all.length },
  };
}

