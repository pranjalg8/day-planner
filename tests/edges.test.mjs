// Edge cases: plan-start boundaries, DST changes, month/year boundaries and the
// small pure helpers (actions, missed). No real clock: every date is explicit.
process.env.TZ = "America/New_York"; // DST: 2026-03-08 (23h day) and 2026-11-01 (25h day)
import test from "node:test";
import assert from "node:assert/strict";
const { planDayNumber, dailyMedActive, dailyMedDayNumber, weeklyMedActiveToday } = await import("../engine.js");
const { dayStats, rangeStats, heatmap, weeklySummary, streaks, weekdayAverages } = await import("../insightsdata.js");
const { weekStartOf, weekKeys, keyOf } = await import("../reportdata.js");
const { markDone, unmarkDone, parseDeepLink, parseDateKey } = await import("../actions.js");
const { findMissed, missedHint, GENERIC_MISSED_HINT } = await import("../missed.js");
const { splitItems } = await import("../catchup.js");

const d = (s) => new Date(s + "T12:00:00");
const plan = (program) => ({ program });

test("TZ is applied (guards the DST tests below)", () => {
  assert.equal(new Date(2026, 2, 9).getTime() - new Date(2026, 2, 8).getTime(), 23 * 3600000);
});

test("planDayNumber: before start is null, start is day 1, DST changes do not skip or repeat a day", () => {
  const p = plan({ planStart: "2026-03-07" });
  assert.equal(planDayNumber(d("2026-03-06"), p), null);
  assert.equal(planDayNumber(d("2026-03-07"), p), 1);
  assert.equal(planDayNumber(d("2026-03-08"), p), 2); // spring forward (23h day)
  assert.equal(planDayNumber(d("2026-03-09"), p), 3);
  const q = plan({ planStart: "2026-10-31" });
  assert.equal(planDayNumber(d("2026-11-01"), q), 2); // fall back (25h day)
  assert.equal(planDayNumber(d("2026-11-02"), q), 3);
  assert.equal(planDayNumber(new Date(2026, 10, 2, 0, 0, 0), q), 3, "midnight local");
  assert.equal(planDayNumber(new Date(2026, 10, 1, 23, 59, 59), q), 2, "last second of the 25h day");
});

test("planDayNumber across month and year boundaries and a leap day", () => {
  assert.equal(planDayNumber(d("2027-01-01"), plan({ planStart: "2026-12-31" })), 2);
  assert.equal(planDayNumber(d("2028-03-01"), plan({ planStart: "2028-02-28" })), 3);
  assert.equal(planDayNumber(d("2027-03-01"), plan({ planStart: "2027-02-28" })), 2);
});

test("daily medicine course window is inclusive at both ends", () => {
  const p = plan({ dailyMedsCourseStart: "2026-03-01", dailyMedsCourseDays: 10 });
  assert.equal(dailyMedActive(d("2026-02-28"), p), false);
  assert.equal(dailyMedActive(d("2026-03-01"), p), true);
  assert.equal(dailyMedDayNumber(d("2026-03-10"), p), 10);
  assert.equal(dailyMedActive(d("2026-03-10"), p), true);
  assert.equal(dailyMedActive(d("2026-03-11"), p), false);
});

test("weekly medicine: only on the start weekday, within the course weeks", () => {
  const p = plan({ weeklyMedStart: "2026-03-05", weeklyMedCourseWeeks: 2 }); // a Thursday
  assert.equal(weeklyMedActiveToday(d("2026-03-05"), p), true);
  assert.equal(weeklyMedActiveToday(d("2026-03-06"), p), false);
  assert.equal(weeklyMedActiveToday(d("2026-03-12"), p), true);
  assert.equal(weeklyMedActiveToday(d("2026-03-19"), p), false, "third week is past the course");
  assert.equal(weeklyMedActiveToday(d("2026-02-26"), p), false, "before the start");
});

test("weekStartOf / weekKeys: Monday-first across DST and year boundaries", () => {
  assert.equal(keyOf(weekStartOf(d("2026-03-08"))), "2026-03-02"); // Sunday belongs to the week before
  assert.equal(keyOf(weekStartOf(d("2026-03-09"))), "2026-03-09");
  assert.deepEqual(weekKeys(weekStartOf(d("2026-03-08"))), ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08"]);
  assert.deepEqual(weekKeys(weekStartOf(d("2026-11-01"))).slice(-1), ["2026-11-01"]);
  assert.deepEqual(weekKeys(weekStartOf(d("2026-12-31"))), ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
});

test("insights: heatmap keeps 7 distinct consecutive days through the DST changes", () => {
  for (const today of ["2026-03-12", "2026-11-04"]) {
    const cols = heatmap({ days: {}, log: {} }, d(today), 8);
    const keys = cols.flat().map((c) => c.key);
    assert.equal(keys.length, 56);
    assert.equal(new Set(keys).size, 56, "no repeated or skipped day");
    const utc = (k) => Date.UTC(...k.split("-").map((x, i) => (i === 1 ? x - 1 : +x)));
    for (let i = 1; i < keys.length; i++) assert.equal(utc(keys[i]) - utc(keys[i - 1]), 86400000);
    assert.equal(cols[0][0].date.getDay(), 1);
  }
});

test("insights: plan start day itself counts, the day before and tomorrow do not", () => {
  const today = d("2026-10-08");
  const data = { days: {}, log: {} };
  assert.equal(dayStats(d("2026-09-23"), data, today), null);
  assert.equal(dayStats(d("2026-09-24"), data, today).key, "2026-09-24");
  assert.equal(dayStats(d("2026-10-08"), data, today).key, "2026-10-08");
  assert.equal(dayStats(d("2026-10-09"), data, today), null);
  assert.deepEqual(rangeStats(d("2026-09-22"), d("2026-09-25"), data, today).map((s) => s.key), ["2026-09-24", "2026-09-25"]);
  assert.deepEqual(rangeStats(d("2026-10-07"), d("2026-10-12"), data, today).map((s) => s.key), ["2026-10-07", "2026-10-08"]);
});

test("weeklySummary on a Monday: this week is one day, last week is the full previous week", () => {
  const w = weeklySummary({ days: {}, log: {} }, d("2026-10-05"));
  assert.equal(w.thisWeek.days, 1);
  assert.equal(w.lastWeek.days, 7);
});

test("weeklySummary spanning a month boundary", () => {
  const w = weeklySummary({ days: {}, log: {} }, d("2026-11-03")); // Tue; week starts Mon 2026-11-02, last week 10-26..11-01
  assert.equal(w.thisWeek.days, 2);
  assert.equal(w.lastWeek.days, 7);
});

test("streaks: empty list, today pending, and a break", () => {
  const mk = (key, ratio) => ({ key, ratio });
  assert.deepEqual(streaks([], 0.8, d("2026-10-08")), { current: 0, best: 0 });
  const stats = [mk("2026-10-05", 1), mk("2026-10-06", 0.9), mk("2026-10-07", 0.1), mk("2026-10-08", 0.2)];
  assert.deepEqual(streaks(stats, 0.8, d("2026-10-08")), { current: 0, best: 2 });
  assert.deepEqual(streaks(stats.slice(0, 2).concat(mk("2026-10-07", 1), mk("2026-10-08", 0.2)), 0.8, d("2026-10-08")), { current: 3, best: 3 });
});

test("weekdayAverages ignores weekdays with a single sample and equal best/worst", () => {
  const s = (key, ratio) => ({ key, date: d(key), ratio });
  const one = weekdayAverages([s("2026-10-05", 1), s("2026-10-06", 0)]);
  assert.equal(one.best, null);
  assert.equal(one.worst, null);
  const same = weekdayAverages([s("2026-10-05", 0.5), s("2026-10-12", 0.5), s("2026-10-06", 0.5), s("2026-10-13", 0.5)]);
  assert.equal(same.best, null);
});

test("markDone / unmarkDone are idempotent and keep other state", () => {
  const s = { overrides: { lunch: "13:00" }, done: ["a"] };
  const s2 = markDone(markDone(s, "b"), "b");
  assert.deepEqual(s2.done, ["a", "b"]);
  assert.deepEqual(s2.overrides, { lunch: "13:00" });
  assert.deepEqual(s.done, ["a"], "input not mutated");
  assert.deepEqual(unmarkDone(s2, "zzz").done, ["a", "b"]);
  assert.deepEqual(unmarkDone({}, "a").done, []);
  assert.deepEqual(markDone({}, "a").done, ["a"]);
});

test("parseDeepLink accepts well-formed params and drops the rest", () => {
  assert.deepEqual(parseDeepLink("?tab=log&done=walk-lunch&snooze=stable-n-fit-am&date=2026-10-08"), { tab: "log", done: "walk-lunch", snooze: "stable-n-fit-am", date: "2026-10-08" });
  assert.deepEqual(parseDeepLink("?tab=LOG&date=2026-1-8&done=a b&snooze=%3Cx%3E"), {});
  assert.deepEqual(parseDeepLink(""), {});
  assert.deepEqual(parseDeepLink(undefined), {});
  assert.deepEqual(parseDeepLink("?done=" + "x".repeat(61)), {});
});

test("parseDateKey: valid, malformed and impossible dates", () => {
  assert.equal(parseDateKey("2026-10-08").getDate(), 8);
  assert.equal(parseDateKey("2028-02-29").getMonth(), 1);
  assert.equal(parseDateKey(""), null);
  assert.equal(parseDateKey(null), null);
  assert.equal(parseDateKey("2026-1-8"), null);
  assert.equal(parseDateKey("2026-02-30"), null, "must not roll over to March");
  assert.equal(parseDateKey("2026-13-01"), null);
});

test("findMissed: medicines only, strict time comparison, past days, done items", () => {
  const it = (id, minutes, category = "medicine", done = false) => ({ id, minutes, category, done });
  const items = [it("m1", 480), it("m2", 600), it("f", 100, "food"), it("m3", 300, "medicine", true)];
  assert.deepEqual(findMissed(items, { isToday: true, isPast: false, nowMin: 600 }).map((i) => i.id), ["m1"]);
  assert.deepEqual(findMissed(items, { isToday: true, isPast: false, nowMin: 601 }).map((i) => i.id), ["m1", "m2"]);
  assert.deepEqual(findMissed(items, { isToday: false, isPast: true, nowMin: 0 }).map((i) => i.id), ["m1", "m2"]);
  assert.deepEqual(findMissed(items, { isToday: false, isPast: false, nowMin: 9999 }), []);
});

test("missedHint falls back to the generic hint", () => {
  assert.equal(missedHint("nope", []), GENERIC_MISSED_HINT);
  assert.equal(missedHint("a", [{ id: "a" }]), GENERIC_MISSED_HINT);
  assert.equal(missedHint("a", [{ id: "a", missedHint: "custom" }]), "custom");
});

test("splitItems: midnight, last minute of the day and an empty day", () => {
  const mk = (id, minutes) => ({ id, minutes, category: "food", done: false });
  const r = splitItems([mk("a", 0), mk("b", 1439)], { isToday: true, isPast: false, nowMin: 0 });
  assert.deepEqual(r.upcoming.map((i) => i.id), ["a", "b"]);
  const r2 = splitItems([mk("a", 0), mk("b", 1439)], { isToday: true, isPast: false, nowMin: 1440 });
  assert.deepEqual(r2.catchUp.map((i) => i.id), ["a", "b"]);
  assert.deepEqual(splitItems([], { isToday: true, isPast: false, nowMin: 5 }), { catchUp: [], upcoming: [], done: [] });
});
