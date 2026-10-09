import test from "node:test";
import assert from "node:assert/strict";
import { parseWeight, validateStep, validateAll, applyToPlan, sideEffects, ONBOARDED_KEY } from "../onboardingdata.js";
import { effectiveTimes, effectiveWorkoutDays, emptyPlan } from "../planstore.js";
import { DEFAULT_TIMES, WORKOUT } from "../data.js";
import { PRIMARY_TABS, SECONDARY_TABS, isSecondary, isKnownTab } from "../nav.js";

const good = () => ({ times: { wake: "06:30", breakfast: "08:00", lunch: "13:00", dinner: "20:00" }, workoutDays: [1, 3, 5], startWeight: "80", goalWeight: "72.5", reminders: false });

test("onboarding flag key is outside the backup prefix", () => {
  assert.ok(!ONBOARDED_KEY.startsWith("elevate-planner:"));
});

test("parseWeight", () => {
  assert.equal(parseWeight("72.5"), 72.5);
  assert.equal(parseWeight(" 72,54 "), 72.5);
  assert.equal(parseWeight(""), null);
  assert.equal(parseWeight(null), null);
  for (const bad of ["abc", "0", "-5", "19.9", "401", "1e9"]) assert.ok(Number.isNaN(parseWeight(bad)), bad);
});

test("validateAll passes a good answer set and a blank-weight one", () => {
  assert.deepEqual(validateAll(good()), {});
  assert.deepEqual(validateAll({ ...good(), startWeight: "", goalWeight: "" }), {});
  assert.deepEqual(validateAll({ ...good(), workoutDays: [] }), {});
});

test("times step catches missing and mis-ordered times", () => {
  assert.ok(validateStep("times", { times: { ...good().times, wake: "" } }).wake);
  assert.ok(validateStep("times", { times: { ...good().times, lunch: "07:00" } }).times);
});

test("workout and weight steps validate", () => {
  assert.ok(validateStep("workout", { workoutDays: [7] }).workoutDays);
  assert.ok(validateStep("workout", {}).workoutDays);
  assert.ok(validateStep("weight", { startWeight: "x", goalWeight: "" }).startWeight);
  assert.ok(validateStep("weight", { startWeight: "", goalWeight: "9" }).goalWeight);
  assert.ok(validateStep("weight", { startWeight: "70", goalWeight: "70" }).goalWeight);
});

test("applyToPlan sets only times that differ from defaults, and workout days", () => {
  const p = applyToPlan(emptyPlan(), { ...good(), times: { ...good().times, breakfast: DEFAULT_TIMES.breakfast } });
  assert.equal(effectiveTimes(p).wake, "06:30");
  assert.equal(effectiveTimes(p).breakfast, DEFAULT_TIMES.breakfast);
  assert.ok(!("breakfast" in p.times));
  assert.deepEqual(effectiveWorkoutDays(p), [1, 3, 5]);
});

test("applyToPlan allows zero workout days and does not mutate input", () => {
  const plan = emptyPlan();
  const p = applyToPlan(plan, { ...good(), workoutDays: [] });
  assert.deepEqual(effectiveWorkoutDays(p), []);
  assert.deepEqual(plan, emptyPlan());
  assert.deepEqual(effectiveWorkoutDays(emptyPlan()), WORKOUT.days);
});

test("sideEffects turns answers into numbers or null", () => {
  assert.deepEqual(sideEffects(good()), { startWeight: 80, goalWeight: 72.5, reminders: false });
  assert.deepEqual(sideEffects({ ...good(), startWeight: "", goalWeight: "junk", reminders: 1 }), { startWeight: null, goalWeight: null, reminders: true });
});

test("nav tab lists keep every legacy tab id reachable", () => {
  assert.deepEqual(PRIMARY_TABS, ["today", "log", "insights", "plan"]);
  assert.deepEqual([...PRIMARY_TABS, ...SECONDARY_TABS].sort(), ["about", "insights", "log", "meds", "plan", "today", "week", "workout"]);
  assert.ok(isSecondary("meds") && !isSecondary("today"));
  assert.ok(isKnownTab("workout") && !isKnownTab("nope"));
});
