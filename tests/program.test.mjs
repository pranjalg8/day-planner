import test from "node:test";
import assert from "node:assert/strict";
import { PROGRAM } from "../data.js";
import {
  effectiveProgram, validateProgramInput, setProgramOverrides, resetProgram, normalizePlan, isEmptyPlan,
  isValidDateKey, loadPlan, savePlan, clearPlan, emptyPlan, PROGRAM_FIELDS,
} from "../planstore.js";
import { computeDay, planDayNumber, dailyMedActive, dailyMedDayNumber, weeklyMedActiveToday } from "../engine.js";
import { dayStats, buildInsights, parseKey } from "../insightsdata.js";

const d = (s) => new Date(s + "T12:00:00");
const ids = (items) => items.map((i) => i.id);
const base = () => ({ ...PROGRAM });
const input = (over = {}) => ({ ...base(), ...over });

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

test("effectiveProgram equals PROGRAM for an empty or missing plan", () => {
  assert.deepEqual(effectiveProgram({}), PROGRAM);
  assert.deepEqual(effectiveProgram(emptyPlan()), PROGRAM);
  assert.deepEqual(effectiveProgram(null), PROGRAM);
});

test("effectiveProgram layers only the edited fields", () => {
  const e = effectiveProgram({ program: { planStart: "2026-11-02", dailyMedsCourseDays: 45 } });
  assert.equal(e.planStart, "2026-11-02");
  assert.equal(e.dailyMedsCourseDays, 45);
  assert.equal(e.reviewDate, PROGRAM.reviewDate);
  assert.equal(e.weeklyMedDayOfWeek, PROGRAM.weeklyMedDayOfWeek);
});

test("weekly medicine weekday follows an edited weeklyMedStart", () => {
  // 2026-10-06 is a Tuesday
  const e = effectiveProgram({ program: { weeklyMedStart: "2026-10-06" } });
  assert.equal(e.weeklyMedDayOfWeek, 2);
  assert.equal(weeklyMedActiveToday(d("2026-10-06"), { program: { weeklyMedStart: "2026-10-06" } }), true);
  assert.equal(weeklyMedActiveToday(d("2026-10-13"), { program: { weeklyMedStart: "2026-10-06" } }), true);
  assert.equal(weeklyMedActiveToday(d("2026-10-08"), { program: { weeklyMedStart: "2026-10-06" } }), false); // old Thursday
});

test("normalizePlan drops invalid or default-equal program values", () => {
  const p = normalizePlan({ program: { planStart: "not-a-date", dailyMedsCourseStart: "2026-02-30", dailyMedsCourseDays: 0, weeklyMedCourseWeeks: 1.5, reviewDate: PROGRAM.reviewDate, weeklyMedStart: "2026-10-01", bogus: 1 } });
  assert.deepEqual(p.program, { weeklyMedStart: "2026-10-01" });
  assert.deepEqual(normalizePlan({ program: "x" }).program, {});
});

test("isEmptyPlan accounts for program edits", () => {
  assert.equal(isEmptyPlan({}), true);
  assert.equal(isEmptyPlan({ program: { planStart: "2026-11-01" } }), false);
});

test("isValidDateKey checks real calendar dates and range", () => {
  for (const ok of ["2026-10-09", "2028-02-29", "2020-01-01", "2100-12-31"]) assert.equal(isValidDateKey(ok), true, ok);
  for (const bad of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-00-10", "26-10-09", "", null, undefined, 20261009, "2019-12-31", "2101-01-01"]) assert.equal(isValidDateKey(bad), false, String(bad));
});

test("validateProgramInput accepts the defaults and normalises numeric strings", () => {
  const v = validateProgramInput(input({ dailyMedsCourseDays: "45", weeklyMedCourseWeeks: " 8 " }));
  assert.equal(v.ok, true);
  assert.equal(v.value.dailyMedsCourseDays, 45);
  assert.equal(v.value.weeklyMedCourseWeeks, 8);
  assert.deepEqual(Object.keys(v.errors), []);
});

test("validateProgramInput gives a friendly message per bad field", () => {
  const v = validateProgramInput({ planStart: "", dailyMedsCourseStart: "2026-02-31", dailyMedsCourseDays: "0", weeklyMedStart: "abc", weeklyMedCourseWeeks: "-3", reviewDate: "2026-13-40" });
  assert.equal(v.ok, false);
  assert.deepEqual(Object.keys(v.errors).sort(), [...PROGRAM_FIELDS].sort());
  assert.match(v.errors.planStart, /pick a date/i);
  assert.match(v.errors.dailyMedsCourseStart, /not a valid date/i);
  assert.match(v.errors.dailyMedsCourseDays, /whole number from 1 to 365/);
  assert.match(v.errors.weeklyMedCourseWeeks, /whole number from 1 to 104/);
});

test("validateProgramInput rejects out-of-range and non-integer counts", () => {
  for (const bad of ["366", "0", "-1", "2.5", "", "abc", null, NaN]) assert.ok(validateProgramInput(input({ dailyMedsCourseDays: bad })).errors.dailyMedsCourseDays, `days ${bad}`);
  for (const bad of ["105", "0", "1.2", ""]) assert.ok(validateProgramInput(input({ weeklyMedCourseWeeks: bad })).errors.weeklyMedCourseWeeks, `weeks ${bad}`);
  assert.equal(validateProgramInput(input({ dailyMedsCourseDays: 365, weeklyMedCourseWeeks: 104 })).ok, true);
});

test("validateProgramInput rejects a review date before the daily course start", () => {
  const v = validateProgramInput(input({ dailyMedsCourseStart: "2026-10-10", reviewDate: "2026-10-09" }));
  assert.equal(v.ok, false);
  assert.match(v.errors.reviewDate, /before/);
  assert.equal(validateProgramInput(input({ dailyMedsCourseStart: "2026-10-10", reviewDate: "2026-10-10" })).ok, true);
});

test("validateProgramInput tolerates garbage input", () => {
  assert.equal(validateProgramInput(null).ok, false);
  assert.equal(validateProgramInput(undefined).ok, false);
  assert.equal(validateProgramInput("x").ok, false);
});

test("setProgramOverrides stores only differences and is a no-op on invalid input", () => {
  let p = setProgramOverrides({}, input({ planStart: "2026-11-02" }));
  assert.deepEqual(p.program, { planStart: "2026-11-02" });
  // Back to the default value removes the override
  p = setProgramOverrides(p, input());
  assert.deepEqual(p.program, {});
  assert.equal(isEmptyPlan(p), true);
  // Invalid input leaves the plan untouched
  const before = setProgramOverrides({}, input({ reviewDate: "2026-12-01" }));
  assert.deepEqual(setProgramOverrides(before, input({ planStart: "nope" })), before);
});

test("setProgramOverrides keeps other plan parts", () => {
  const p = setProgramOverrides({ workoutDays: [1, 3], times: { wake: "06:00" } }, input({ dailyMedsCourseDays: 20 }));
  assert.deepEqual(p.workoutDays, [1, 3]);
  assert.equal(p.times.wake, "06:00");
  assert.equal(p.program.dailyMedsCourseDays, 20);
});

test("resetProgram clears only program edits", () => {
  const p = resetProgram({ workoutDays: [2], program: { planStart: "2026-11-01" } });
  assert.deepEqual(p.program, {});
  assert.deepEqual(p.workoutDays, [2]);
});

test("engine day numbers follow an edited planStart", () => {
  assert.equal(planDayNumber(d("2026-09-24"), {}), 1);
  const plan = { program: { planStart: "2026-10-01" } };
  assert.equal(planDayNumber(d("2026-09-24"), plan), null);
  assert.equal(planDayNumber(d("2026-10-01"), plan), 1);
  assert.equal(planDayNumber(d("2026-10-05"), plan), 5);
});

test("daily medicine course window moves with start and length", () => {
  const plan = { program: { dailyMedsCourseStart: "2026-10-01", dailyMedsCourseDays: 10 } };
  assert.equal(dailyMedDayNumber(d("2026-10-03"), plan), 3);
  assert.equal(dailyMedActive(d("2026-09-30"), plan), false);
  assert.equal(dailyMedActive(d("2026-10-01"), plan), true);
  assert.equal(dailyMedActive(d("2026-10-10"), plan), true);
  assert.equal(dailyMedActive(d("2026-10-11"), plan), false);
  // default course (2026-09-19 + 30d) ended 2026-10-18, so 2026-10-15 is active by default only
  assert.equal(dailyMedActive(d("2026-10-15"), {}), true);
  assert.equal(dailyMedActive(d("2026-10-15"), plan), false);
});

test("computeDay includes or drops daily medicines according to the edited course", () => {
  const medIds = (plan, day) => ids(computeDay(d(day), {}, new Set(), plan)).filter((i) => ["stable-n-fit-am", "evion-l-5000", "stable-n-fit-pm"].includes(i));
  assert.equal(medIds({}, "2026-10-15").length, 3);
  assert.deepEqual(medIds({ program: { dailyMedsCourseDays: 5 } }, "2026-10-15"), []);
  assert.equal(medIds({ program: { dailyMedsCourseStart: "2026-10-15" } }, "2026-10-15").length, 3);
  assert.deepEqual(medIds({ program: { dailyMedsCourseStart: "2026-10-16" } }, "2026-10-15"), []);
});

test("weekly medicine dose respects edited start and number of weeks", () => {
  // Default: Thursdays from 2026-09-24 for 12 weeks. 2026-10-08 is a Thursday.
  assert.equal(ids(computeDay(d("2026-10-08"), {}, new Set(), {})).includes("uprise-d3-60k"), true);
  const short = { program: { weeklyMedCourseWeeks: 1 } };
  assert.equal(ids(computeDay(d("2026-10-01"), {}, new Set(), short)).includes("uprise-d3-60k"), false);
  assert.equal(ids(computeDay(d("2026-09-24"), {}, new Set(), short)).includes("uprise-d3-60k"), true);
  const later = { program: { weeklyMedStart: "2026-10-15" } };
  assert.equal(ids(computeDay(d("2026-10-08"), {}, new Set(), later)).includes("uprise-d3-60k"), false);
  assert.equal(ids(computeDay(d("2026-10-15"), {}, new Set(), later)).includes("uprise-d3-60k"), true);
  assert.equal(ids(computeDay(d("2026-10-22"), {}, new Set(), later)).includes("uprise-d3-60k"), true);
});

test("computeDay stays backward compatible: no plan arg == program defaults", () => {
  for (const day of ["2026-09-18", "2026-09-24", "2026-10-09", "2026-12-25"]) {
    assert.deepEqual(computeDay(d(day), {}, new Set(), {}), computeDay(d(day)));
  }
});

test("saved plan edits are picked up by the default plan argument", () => {
  const prev = globalThis.localStorage;
  globalThis.localStorage = fakeStorage();
  try {
    assert.equal(dailyMedActive(d("2026-10-15")), true);
    savePlan(setProgramOverrides(loadPlan(), input({ dailyMedsCourseDays: 5 })));
    assert.equal(effectiveProgram().dailyMedsCourseDays, 5);
    assert.equal(dailyMedActive(d("2026-10-15")), false);
    assert.equal(planDayNumber(d("2026-09-24")), 1);
    clearPlan();
    assert.equal(effectiveProgram().dailyMedsCourseDays, PROGRAM.dailyMedsCourseDays);
    assert.equal(dailyMedActive(d("2026-10-15")), true);
  } finally {
    globalThis.localStorage = prev;
  }
});

test("savePlan removes the key when only program edits are reverted", () => {
  const prev = globalThis.localStorage;
  globalThis.localStorage = fakeStorage();
  try {
    savePlan(setProgramOverrides(emptyPlan(), input({ reviewDate: "2026-12-01" })));
    assert.equal(loadPlan().program.reviewDate, "2026-12-01");
    savePlan(resetProgram(loadPlan()));
    assert.equal(globalThis.localStorage.getItem("elevate-planner:plan"), null);
  } finally {
    globalThis.localStorage = prev;
  }
});

test("insights start from the edited planStart", () => {
  const today = d("2026-10-09");
  const data = { days: {}, log: {}, goal: null };
  const prev = globalThis.localStorage;
  globalThis.localStorage = fakeStorage();
  try {
    assert.ok(dayStats(d("2026-09-24"), data, today));
    assert.equal(dayStats(d("2026-09-30"), data, today)?.key, "2026-09-30");
    assert.equal(buildInsights(data, today).totals.days, 16);
    savePlan(setProgramOverrides(loadPlan(), input({ planStart: "2026-10-01" })));
    assert.equal(dayStats(d("2026-09-30"), data, today), null);
    assert.equal(dayStats(d("2026-10-01"), data, today)?.key, "2026-10-01");
    assert.equal(buildInsights(data, today).totals.days, 9);
  } finally {
    globalThis.localStorage = prev;
  }
});
