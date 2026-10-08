import test from "node:test";
import assert from "node:assert/strict";
import { computeDay } from "../engine.js";
import { PROGRAM } from "../data.js";
import { dayStats, weeklySummary, heatmap, linearTrend, trendText, weekdayAverages, streaks, buildInsights, readAll, setGoal, rangeStats, parseKey } from "../insightsdata.js";

const d = (s) => new Date(s + "T12:00:00");
const TODAY = d("2026-10-08"); // Thursday
function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const allIds = (s) => computeDay(d(s)).map((i) => i.id);

test("days before plan start and future days are skipped", () => {
  assert.equal(dayStats(d("2026-09-20"), { days: {}, log: {} }, TODAY), null);
  assert.equal(dayStats(d("2026-10-09"), { days: {}, log: {} }, TODAY), null);
  assert.ok(dayStats(d("2026-09-24"), { days: {}, log: {} }, TODAY));
});

test("dayStats counts done ids by group, ignoring unknown ids", () => {
  const data = { days: { "2026-10-05": { overrides: {}, done: [...allIds("2026-10-05"), "bogus"] } }, log: {} };
  const s = dayStats(d("2026-10-05"), data, TODAY);
  assert.equal(s.done, s.total);
  assert.equal(s.ratio, 1);
  assert.ok(s.byGroup.meals.total >= 3);
  const none = dayStats(d("2026-10-06"), data, TODAY);
  assert.equal(none.done, 0);
  assert.equal(none.hasState, false);
});

test("weekly summary compares this and last week", () => {
  const days = {};
  for (const k of ["2026-09-28", "2026-09-29"]) days[k] = { overrides: {}, done: allIds(k) };
  days["2026-10-05"] = { overrides: {}, done: allIds("2026-10-05").filter((i) => i.startsWith("water")) };
  const log = { "2026-10-05": { water: 8, steps: 3000, sets: { 0: 2 } }, "2026-10-06": { water: 4, steps: 1000 } };
  const w = weeklySummary({ days, log }, TODAY);
  assert.equal(w.lastWeek.days, 7);
  assert.equal(w.thisWeek.days, 4);
  assert.ok(w.lastWeek.overall > 0 && w.lastWeek.overall < 1);
  assert.ok(w.thisWeek.groups.water.done > 0);
  assert.equal(w.thisWeek.litres, 3);
  assert.equal(w.thisWeek.avgSteps, 2000);
  assert.equal(w.thisWeek.sets, 2);
  assert.equal(w.thisWeek.groups.meals.done, 0);
});

test("empty data yields zeros not NaN", () => {
  const r = buildInsights({ days: {}, log: {}, goal: null }, TODAY);
  assert.equal(r.hasData, false);
  assert.equal(r.totals.sets, 0);
  assert.equal(r.streaks.current, 0);
  assert.equal(r.weights.length, 0);
});

test("heatmap is 8 columns of 7, nulls outside range", () => {
  const h = heatmap({ days: {}, log: {} }, TODAY, 8);
  assert.equal(h.length, 8);
  assert.ok(h.every((c) => c.length === 7));
  assert.equal(h[0][0].ratio, null); // before plan start
  assert.equal(h[7][3].ratio, 0); // today, no state
  assert.equal(h[7][4].ratio, null); // future
});

test("linearTrend and trendText", () => {
  const pts = [0, 7, 14].map((n, i) => ({ date: ["2026-10-01", "2026-10-08", "2026-10-15"][i], kg: 80 - i }));
  const tr = linearTrend(pts);
  assert.ok(Math.abs(tr.perWeek + 1) < 1e-9);
  assert.match(trendText(pts, 76), /down about 1\.0 kg per week/);
  assert.match(trendText(pts, 76), /roughly 2 weeks/);
  assert.match(trendText(pts, 85), /not heading that way/);
  assert.match(trendText([], null), /No weigh-ins/);
  assert.equal(linearTrend([pts[0]]), null);
});

test("weekday averages pick best and worst", () => {
  const mk = (s, ratio) => ({ key: s, date: d(s), ratio });
  const r = weekdayAverages([mk("2026-10-05", 1), mk("2026-10-12", 1), mk("2026-10-06", 0.2), mk("2026-10-13", 0.2)]);
  assert.equal(r.best.name, "Monday");
  assert.equal(r.worst.name, "Tuesday");
  assert.equal(weekdayAverages([mk("2026-10-05", 1)]).best, null);
});

test("streaks: best, current, today pending", () => {
  const mk = (s, ratio) => ({ key: s, date: d(s), ratio });
  const st = [mk("2026-10-01", 1), mk("2026-10-02", 1), mk("2026-10-03", 1), mk("2026-10-04", 0), mk("2026-10-05", 1), mk("2026-10-06", 0.9), mk("2026-10-08", 0.1)];
  const r = streaks(st, 0.8, TODAY);
  assert.equal(r.best, 3);
  assert.equal(r.current, 2);
});

test("readAll and setGoal use storage", () => {
  const s = mem();
  s.setItem("elevate-planner:2026-10-05", JSON.stringify({ overrides: {}, done: ["wake-weigh"] }));
  s.setItem("elevate-planner:log", JSON.stringify({ "2026-10-05": { weight: 80 } }));
  s.setItem("elevate-planner:history", "{}");
  setGoal("72.5", s);
  const a = readAll(s);
  assert.deepEqual(Object.keys(a.days), ["2026-10-05"]);
  assert.equal(a.goal, 72.5);
  setGoal("", s);
  assert.equal(readAll(s).goal, null);
  assert.equal(readAll(mem()).goal, null);
});

test("rangeStats totals", () => {
  const r = rangeStats(parseKey(PROGRAM.planStart), TODAY, { days: {}, log: {} }, TODAY);
  assert.equal(r.length, 15);
});
