import test from "node:test";
import assert from "node:assert/strict";
import { noteKeyOf, getMedNote, setMedNote, supplyStatus, refillMessages, MAX_NOTE_LENGTH, NOTES_KEY } from "../medextras.js";

const d = (s) => new Date(s + "T12:00:00");
function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const PROG = { dailyMedsCourseStart: "2026-09-19", dailyMedsCourseDays: 30, weeklyMedStart: "2026-09-24", weeklyMedCourseWeeks: 12 };

test("AM and PM entries share one note key", () => {
  assert.equal(noteKeyOf("stable-n-fit-am"), "stable-n-fit");
  assert.equal(noteKeyOf("stable-n-fit-pm"), "stable-n-fit");
  assert.equal(noteKeyOf("evion-l-5000"), "evion-l-5000");
});

test("notes save, share across AM/PM, trim, cap and clear", () => {
  const s = mem();
  assert.equal(getMedNote("stable-n-fit-am", s), "");
  setMedNote("stable-n-fit-am", "  with food  ", s);
  assert.equal(getMedNote("stable-n-fit-pm", s), "with food");
  setMedNote("evion-l-5000", "x".repeat(MAX_NOTE_LENGTH + 50), s);
  assert.equal(getMedNote("evion-l-5000", s).length, MAX_NOTE_LENGTH);
  setMedNote("stable-n-fit-am", "   ", s); // blank clears
  assert.equal(getMedNote("stable-n-fit-pm", s), "");
});

test("corrupt stored notes are ignored", () => {
  const s = mem();
  s.setItem(NOTES_KEY, "not json");
  assert.equal(getMedNote("x", s), "");
  s.setItem(NOTES_KEY, "[1,2]");
  assert.equal(getMedNote("x", s), "");
  assert.doesNotThrow(() => setMedNote("x", "ok", s));
  assert.equal(getMedNote("x", s), "ok");
});

test("daily course: ok, soon, last day, ended, not started", () => {
  // course Sep 19 + 30 days => last day Oct 18
  assert.equal(supplyStatus(d("2026-10-01"), PROG).daily.status, "ok");
  const soon = supplyStatus(d("2026-10-13"), PROG).daily;
  assert.equal(soon.status, "soon");
  assert.equal(soon.daysLeft, 5);
  assert.equal(supplyStatus(d("2026-10-12"), PROG).daily.status, "ok"); // 6 days left
  assert.equal(supplyStatus(d("2026-10-18"), PROG).daily.status, "last");
  assert.equal(supplyStatus(d("2026-10-19"), PROG).daily.status, "ended");
  assert.equal(supplyStatus(d("2026-09-10"), PROG).daily.status, "not-started");
  assert.equal(supplyStatus(d("2026-10-18"), PROG).daily.endDate, "2026-10-18");
});

test("weekly course counts remaining doses and the next date", () => {
  // doses every Thursday from Sep 24, 12 doses; last = Dec 10
  const w = supplyStatus(d("2026-10-11"), PROG).weekly; // Sunday -> next Thu Oct 15 (dose index 3)
  assert.equal(w.nextDose, "2026-10-15");
  assert.equal(w.dosesLeft, 9);
  assert.equal(w.lastDose, "2026-12-10");
  assert.equal(supplyStatus(d("2026-10-15"), PROG).weekly.nextDose, "2026-10-15"); // dose day counts
  assert.equal(supplyStatus(d("2026-12-03"), PROG).weekly.status, "soon"); // 2 left
  assert.equal(supplyStatus(d("2026-12-10"), PROG).weekly.status, "last");
  assert.equal(supplyStatus(d("2026-12-11"), PROG).weekly.status, "ended");
  assert.equal(supplyStatus(d("2026-09-01"), PROG).weekly.status, "not-started");
});

test("refill messages only appear when a course is ending", () => {
  assert.deepEqual(refillMessages(d("2026-10-01"), PROG), []);
  assert.equal(refillMessages(d("2026-10-14"), PROG).length, 1);
  assert.match(refillMessages(d("2026-10-14"), PROG)[0], /4 days left/);
  assert.match(refillMessages(d("2026-10-18"), PROG)[0], /last day/);
  assert.deepEqual(refillMessages(d("2026-10-25"), PROG), []); // ended: no nag
});
