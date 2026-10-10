import test from "node:test";
import assert from "node:assert/strict";
import { computeDay } from "../engine.js";
import { reviewWeekFor, isReviewDue, buildReview, weekStartOf } from "../weeklyreviewdata.js";
import { dateKey } from "../insightsdata.js";

const d = (s) => new Date(s + "T12:00:00");
const ids = (s) => computeDay(d(s)).map((i) => i.id);
const byCat = (s, cats) => computeDay(d(s)).filter((i) => cats.includes(i.category)).map((i) => i.id);
const PLAN = "2026-09-24";

test("review week: this week on Sunday, last week otherwise", () => {
  assert.equal(dateKey(reviewWeekFor(d("2026-10-11"))), "2026-10-05"); // Sunday
  assert.equal(dateKey(reviewWeekFor(d("2026-10-12"))), "2026-10-05"); // Monday -> week that just ended
  assert.equal(dateKey(reviewWeekFor(d("2026-10-14"))), "2026-10-05"); // Wednesday
  assert.equal(dateKey(weekStartOf(d("2026-10-11"))), "2026-10-05");
});

test("due on Sun/Mon/Tue until seen; not Wed-Sat; not for weeks before the plan", () => {
  assert.equal(isReviewDue(d("2026-10-11"), null, PLAN), true);
  assert.equal(isReviewDue(d("2026-10-12"), null, PLAN), true);
  assert.equal(isReviewDue(d("2026-10-13"), null, PLAN), true);
  assert.equal(isReviewDue(d("2026-10-14"), null, PLAN), false);
  assert.equal(isReviewDue(d("2026-10-11"), "2026-10-05", PLAN), false); // seen
  assert.equal(isReviewDue(d("2026-10-12"), "2026-10-05", PLAN), false);
  assert.equal(isReviewDue(d("2026-09-21"), null, PLAN), false); // week ended before the plan
});

test("review compares with the previous week and finds the weak area", () => {
  const days = {};
  // last week (Sep 28 - Oct 4): half the days fully done
  for (const k of ["2026-09-28", "2026-09-29", "2026-09-30"]) days[k] = { overrides: {}, done: ids(k) };
  // review week (Oct 5 - Oct 11): everything except medicines on 5 days
  for (const k of ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]) {
    const meds = new Set(byCat(k, ["medicine"]));
    days[k] = { overrides: {}, done: ids(k).filter((i) => !meds.has(i)) };
  }
  const r = buildReview({ days, log: { "2026-10-05": { water: 8 } } }, d("2026-10-05"), d("2026-10-12"));
  assert.equal(r.weekStart, "2026-10-05");
  assert.equal(r.weekEnd, "2026-10-11");
  assert.equal(r.days, 7);
  assert.equal(r.complete, true);
  assert.equal(r.groups.find((g) => g.id === "medicines").pct, 0);
  assert.match(r.suggestion.title, /Medicines/);
  assert.ok(r.groups.find((g) => g.id === "meals").pct > 0.5);
  assert.ok(r.wins.some((w) => /water/i.test(w)));
  assert.ok(r.bestDay && r.worstDay);
});

test("an in-progress week only counts days up to today", () => {
  const r = buildReview({ days: {}, log: {} }, d("2026-10-05"), d("2026-10-07"));
  assert.equal(r.days, 3);
  assert.equal(r.complete, false);
});

test("a perfect week gets the steady message and no weak area", () => {
  const days = {};
  for (let i = 5; i <= 11; i++) { const k = `2026-10-${String(i).padStart(2, "0")}`; days[k] = { overrides: {}, done: ids(k) }; }
  const r = buildReview({ days, log: {} }, d("2026-10-05"), d("2026-10-12"));
  assert.equal(r.overall, 1);
  assert.equal(r.suggestion.title, "Steady week");
});

test("no data yields a friendly message, not NaN", () => {
  const r = buildReview({ days: {}, log: {} }, d("2026-10-05"), d("2026-10-12"));
  assert.ok(Number.isFinite(r.days));
  assert.equal(r.overall, 0);
  assert.ok(r.suggestion.title.length > 0);
});
