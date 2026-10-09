import { test } from "node:test";
import assert from "node:assert/strict";
import { splitItems, bulkMarkable, nextUpcoming } from "../catchup.js";

const mk = (id, minutes, category = "food", done = false) => ({ id, minutes, category, done });
const items = [mk("a", 360), mk("b", 420, "medicine"), mk("c", 480, "food", true), mk("d", 900), mk("e", 1200, "medicine")];

test("today: unchecked earlier items are catch-up, later ones upcoming", () => {
  const r = splitItems(items, { isToday: true, isPast: false, nowMin: 600 });
  assert.deepEqual(r.catchUp.map((i) => i.id), ["a", "b"]);
  assert.deepEqual(r.upcoming.map((i) => i.id), ["d", "e"]);
  assert.deepEqual(r.done.map((i) => i.id), ["c"]);
});

test("past day: every unchecked item is catch-up", () => {
  const r = splitItems(items, { isToday: false, isPast: true, nowMin: 0 });
  assert.deepEqual(r.catchUp.map((i) => i.id), ["a", "b", "d", "e"]);
  assert.equal(r.upcoming.length, 0);
});

test("future day: everything unchecked is upcoming", () => {
  const r = splitItems(items, { isToday: false, isPast: false, nowMin: 0 });
  assert.equal(r.catchUp.length, 0);
  assert.deepEqual(r.upcoming.map((i) => i.id), ["a", "b", "d", "e"]);
});

test("item exactly at the current minute is still upcoming", () => {
  const r = splitItems([mk("x", 600)], { isToday: true, isPast: false, nowMin: 600 });
  assert.equal(r.upcoming.length, 1);
});

test("bulk marking skips medicines", () => {
  assert.deepEqual(bulkMarkable(items).map((i) => i.id), ["a", "c", "d"]);
});

test("nextUpcoming only applies to today", () => {
  const up = [mk("d", 900)];
  assert.equal(nextUpcoming(up, true).id, "d");
  assert.equal(nextUpcoming(up, false), null);
  assert.equal(nextUpcoming([], true), null);
});
