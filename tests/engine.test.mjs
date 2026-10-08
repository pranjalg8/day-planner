import test from "node:test";
import assert from "node:assert/strict";
import { computeDay, toMinutes, toHHMM, dailyMedActive, weeklyMedActiveToday } from "../engine.js";
import { DEFAULT_TIMES, WORKOUT, ACTIONS } from "../data.js";

// Local-time dates (engine uses local getters). 2026-09-24 is a Thursday.
const d = (s) => new Date(s + "T12:00:00");
const IN_COURSE_THU = d("2026-09-24");
const IN_COURSE_FRI = d("2026-09-25");
const byId = (items, id) => items.find((i) => i.id === id);
const time = (items, id) => byId(items, id)?.time;
const plus = (hhmm, m) => toHHMM(toMinutes(hhmm) + m);

test("time helpers round-trip and wrap", () => {
  assert.equal(toMinutes("07:30"), 450);
  assert.equal(toHHMM(450), "07:30");
  assert.equal(toHHMM(1500), "01:00");
  assert.equal(toHHMM(-30), "23:30");
});

test("morning medicine buffer: L-Carnitine and B12 wait 60 min after Stable N Fit", () => {
  const items = computeDay(IN_COURSE_FRI);
  const stable = plus(DEFAULT_TIMES.breakfast, 5);
  assert.equal(time(items, "stable-n-fit-am"), stable);
  const clear = plus(stable, 60);
  assert.equal(time(items, "l-carnitine-am"), clear);
  assert.equal(time(items, "b12-matilda-forte-am"), clear);
});

test("dinner medicine buffer: L-Carnitine and Roseday-F wait 60 min after Stable N Fit", () => {
  const items = computeDay(IN_COURSE_FRI);
  const stable = plus(DEFAULT_TIMES.dinner, 5);
  assert.equal(time(items, "stable-n-fit-pm"), stable);
  assert.equal(time(items, "l-carnitine-pm"), plus(stable, 60));
  assert.equal(time(items, "roseday-f-10"), plus(stable, 60));
});

test("buffers follow overridden meal times", () => {
  const items = computeDay(IN_COURSE_FRI, { breakfast: "09:00", dinner: "20:15" });
  assert.equal(time(items, "stable-n-fit-am"), "09:05");
  assert.equal(time(items, "l-carnitine-am"), "10:05");
  assert.equal(time(items, "stable-n-fit-pm"), "20:20");
  assert.equal(time(items, "roseday-f-10"), "21:20");
});

test("Evion L is 15 min after lunch", () => {
  assert.equal(time(computeDay(IN_COURSE_FRI), "evion-l-5000"), plus(DEFAULT_TIMES.lunch, 15));
});

test("daily-course meds are absent outside the 30-day course; ongoing B12 stays", () => {
  const before = computeDay(d("2026-09-18"));
  const after = computeDay(d("2026-10-19"));
  for (const items of [before, after]) {
    for (const id of ["stable-n-fit-am", "stable-n-fit-pm", "l-carnitine-am", "l-carnitine-pm", "roseday-f-10", "evion-l-5000"]) {
      assert.equal(byId(items, id), undefined, id);
    }
    assert.ok(byId(items, "b12-matilda-forte-am"));
    assert.equal(time(items, "b12-matilda-forte-am"), plus(DEFAULT_TIMES.breakfast, 65));
  }
});

test("30-day course boundaries", () => {
  assert.equal(dailyMedActive(d("2026-09-18")), false);
  assert.equal(dailyMedActive(d("2026-09-19")), true);
  assert.equal(dailyMedActive(d("2026-10-18")), true);
  assert.equal(dailyMedActive(d("2026-10-19")), false);
});

test("weekly D3 only on Thursdays within 12 weeks", () => {
  assert.ok(byId(computeDay(IN_COURSE_THU), "uprise-d3-60k"));
  assert.equal(time(computeDay(IN_COURSE_THU), "uprise-d3-60k"), plus(DEFAULT_TIMES.lunch, 15));
  assert.equal(byId(computeDay(IN_COURSE_FRI), "uprise-d3-60k"), undefined);
  assert.equal(weeklyMedActiveToday(d("2026-09-17")), false); // Thursday before start
  assert.equal(weeklyMedActiveToday(d("2026-12-10")), true); // 12th Thursday
  assert.equal(weeklyMedActiveToday(d("2026-12-17")), false); // 13th
});

test("post-meal walks start 5 min after each meal", () => {
  const items = computeDay(IN_COURSE_FRI, { breakfast: "08:00", lunch: "13:00", dinner: "20:00" });
  assert.equal(time(items, "walk-breakfast"), "08:05");
  assert.equal(time(items, "walk-lunch"), "13:05");
  assert.equal(time(items, "walk-dinner"), "20:05");
  assert.match(byId(items, "walk-lunch").label, new RegExp(`${ACTIONS.walkAfterMealMin}-min walk`));
});

test("workout items: warm-up at workout time, circuit sequential", () => {
  const items = computeDay(IN_COURSE_FRI);
  assert.equal(time(items, "workout-warmup"), DEFAULT_TIMES.workout);
  let at = toMinutes(DEFAULT_TIMES.workout) + WORKOUT.warmupMin;
  WORKOUT.circuit.forEach((_, i) => {
    assert.equal(time(items, `workout-${i + 1}`), toHHMM(at));
    at += WORKOUT.exerciseMin;
  });
  assert.equal(time(items, "stretch"), DEFAULT_TIMES.stretch);
});

test("workout shifts when the workout time override changes", () => {
  const base = computeDay(IN_COURSE_FRI);
  const moved = computeDay(IN_COURSE_FRI, { workout: "06:00" });
  const delta = -60;
  for (const id of ["workout-warmup", ...WORKOUT.circuit.map((_, i) => `workout-${i + 1}`)]) {
    assert.equal(byId(moved, id).minutes - byId(base, id).minutes, delta, id);
  }
  assert.equal(time(moved, "stretch"), time(base, "stretch"));
});

test("items are sorted by time", () => {
  for (const day of [IN_COURSE_THU, IN_COURSE_FRI, d("2026-12-01")]) {
    const items = computeDay(day, { breakfast: "09:15", workout: "06:45" });
    for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].minutes <= items[i].minutes);
  }
});

test("item ids are unique", () => {
  const ids = computeDay(IN_COURSE_THU).map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("done flags reflect doneIds", () => {
  const items = computeDay(IN_COURSE_FRI, {}, new Set(["breakfast", "walk-lunch"]));
  assert.equal(byId(items, "breakfast").done, true);
  assert.equal(byId(items, "walk-lunch").done, true);
  assert.equal(byId(items, "lunch").done, false);
  assert.equal(computeDay(IN_COURSE_FRI).every((i) => !i.done), true);
});

test("water checkpoints and almonds prep are present", () => {
  const items = computeDay(IN_COURSE_FRI);
  assert.equal(items.filter((i) => i.category === "water").length, ACTIONS.waterCheckpoints);
  assert.equal(time(items, "soak-almonds"), plus(DEFAULT_TIMES.bedtime, -30));
});
