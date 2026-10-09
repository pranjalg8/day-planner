import test from "node:test";
import assert from "node:assert/strict";
import { logAllowed, setsProgress, nextSetToLog, tapSetCount, medsProgress, pickNextItem, glassTarget } from "../glance.js";

const circuit = [{ sets: 3 }, { sets: 3 }, { sets: 2 }];

test("logAllowed: today and past yes, future no", () => {
  assert.equal(logAllowed("2026-10-09", "2026-10-09"), true);
  assert.equal(logAllowed("2026-10-08", "2026-10-09"), true);
  assert.equal(logAllowed("2026-10-10", "2026-10-09"), false);
});

test("setsProgress caps at set count and ignores missing", () => {
  assert.deepEqual(setsProgress({}, circuit), { done: 0, total: 8 });
  assert.deepEqual(setsProgress({ 0: 5, 1: 1, 2: 2 }, circuit), { done: 6, total: 8 });
});

test("nextSetToLog cycles to first incomplete exercise", () => {
  assert.equal(nextSetToLog({}, circuit), 0);
  assert.equal(nextSetToLog({ 0: 3, 1: 1 }, circuit), 1);
  assert.equal(nextSetToLog({ 0: 3, 1: 3, 2: 2 }, circuit), -1);
});

test("tapSetCount toggles like the Log tab", () => {
  assert.equal(tapSetCount(0, 0), 1);
  assert.equal(tapSetCount(2, 2), 3);
  assert.equal(tapSetCount(3, 1), 1); // tapping a done tick un-does from there
  assert.equal(tapSetCount(1, 0), 0);
});

test("medsProgress counts only medicine items taken", () => {
  const items = [{ id: "a", category: "medicine" }, { id: "b", category: "medicine" }, { id: "c", category: "food" }];
  assert.deepEqual(medsProgress(items, new Set(["a", "c"])), { done: 1, total: 2 });
});

test("pickNextItem: upcoming today, first open on other days", () => {
  const items = [{ id: 1, minutes: 400, done: false }, { id: 2, minutes: 600, done: true }, { id: 3, minutes: 700, done: false }];
  assert.equal(pickNextItem(items, true, 500).id, 3);
  assert.equal(pickNextItem(items, true, 800), null);
  assert.equal(pickNextItem(items, false, 0).id, 1);
});

test("glassTarget rounds up", () => {
  assert.equal(glassTarget(3), 12);
  assert.equal(glassTarget(2.1), 9);
});
