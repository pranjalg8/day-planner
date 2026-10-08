import test from "node:test";
import assert from "node:assert/strict";
import { weekStartOf, weekKeys, keyOf, buildWeekData, buildReport, defaultInclude, reportFilename } from "../reportdata.js";

const start = weekStartOf(new Date(2026, 0, 7)); // Wed -> Mon 2026-01-05
const data = buildWeekData({
  start,
  log: {
    "2026-01-05": { weight: 80, water: 2, steps: 3000, sets: { 0: 3, 1: 2 } },
    "2026-01-07": { weight: 79.4, water: 1.5, steps: 1000 },
    "2026-01-20": { weight: 1 },
  },
  taken: { "2026-01-05": ["a", "b"], "2026-01-06": ["a"] },
  history: { "2026-01-05": { done: 8, total: 10 }, "2026-01-06": { done: 2, total: 10 } },
  expectedMeds: { "2026-01-05": 3, "2026-01-06": 3 },
  totalSets: 12,
  targets: { water: 2, steps: 2000 },
});

test("week helpers", () => {
  assert.equal(keyOf(start), "2026-01-05");
  assert.equal(keyOf(weekStartOf(new Date(2026, 0, 4))), "2025-12-29", "Sunday belongs to the previous Monday");
  assert.deepEqual(weekKeys(start).slice(-1), ["2026-01-11"]);
});

test("buildWeekData aggregates only that week", () => {
  assert.equal(data.adherence.percent, 50);
  assert.equal(data.adherence.daysTracked, 2);
  assert.equal(data.water.totalL, 3.5);
  assert.equal(data.steps.avg, 2000);
  assert.equal(data.workouts.sets, 5);
  assert.equal(data.workouts.daysWorked, 1);
  assert.deepEqual(data.meds, { taken: 3, expected: 6 });
  assert.equal(data.weight.change, -0.6);
  assert.equal(data.weight.entries, 2);
});

test("default report excludes weight", () => {
  assert.equal(defaultInclude().weight, false);
  const md = buildReport(data);
  assert.ok(!/weight/i.test(md.replace("Weekly report", "")), md);
  assert.ok(!md.includes("80") && !md.includes("79.4"));
  assert.match(md, /50% of plan items/);
  assert.match(md, /3 of 6 scheduled doses/);
});

test("toggles control sections", () => {
  const none = Object.fromEntries(Object.keys(defaultInclude()).map((k) => [k, false]));
  const md = buildReport(data, { ...none, weight: true });
  assert.match(md, /## Weight/);
  assert.match(md, /change -0\.6 kg/);
  assert.ok(!md.includes("## Water"));
});

test("empty week is handled", () => {
  const e = buildWeekData({ start });
  const md = buildReport(e, { adherence: true, water: true, steps: true, workouts: true, meds: true, weight: true });
  assert.match(md, /No tracked days/);
  assert.match(md, /No weight logged/);
  assert.equal(reportFilename(e), "weekly-report-2026-01-05.md");
});
