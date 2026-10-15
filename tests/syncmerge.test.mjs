import test from "node:test";
import assert from "node:assert/strict";
import { mergeValues } from "../syncmerge.js";

const P = "elevate-planner:";
const j = JSON.stringify;

test("day state: done union, server overrides win, local fills missing", () => {
  const s = j({ done: ["a", "b"], overrides: { x: 1 } });
  const l = j({ done: ["b", "c"], overrides: { x: 2, y: 3 } });
  const m = JSON.parse(mergeValues(P + "2026-10-01", s, l));
  assert.deepEqual(m.done, ["a", "b", "c"]);
  assert.deepEqual(m.overrides, { x: 1, y: 3 });
});

test("log: max water/steps/sets, weight non-null (server first)", () => {
  const s = j({ "2026-10-01": { weight: null, water: 3, steps: 100, sets: { 0: 2 } }, "2026-10-02": { water: 1 } });
  const l = j({ "2026-10-01": { weight: 80, water: 5, steps: null, sets: { 0: 1, 1: 4 } }, "2026-10-03": { water: 2 } });
  const m = JSON.parse(mergeValues(P + "log", s, l));
  assert.equal(m["2026-10-01"].weight, 80);
  assert.equal(m["2026-10-01"].water, 5);
  assert.equal(m["2026-10-01"].steps, 100);
  assert.deepEqual(m["2026-10-01"].sets, { 0: 2, 1: 4 });
  assert.ok(m["2026-10-02"] && m["2026-10-03"]);
  const both = JSON.parse(mergeValues(P + "log", j({ d: { weight: 70 } }), j({ d: { weight: 80 } })));
  assert.equal(both.d.weight, 70);
});

test("meds union, history larger done, others server wins", () => {
  assert.deepEqual(JSON.parse(mergeValues(P + "meds", j({ d: ["a"] }), j({ d: ["b"], e: ["c"] }))), { d: ["a", "b"], e: ["c"] });
  const h = JSON.parse(mergeValues(P + "history", j({ d: { done: 2, total: 5 } }), j({ d: { done: 4, total: 5 }, e: { done: 1, total: 2 } })));
  assert.equal(h.d.done, 4); assert.equal(h.e.done, 1);
  assert.equal(mergeValues(P + "plan", j({ a: 1 }), j({ a: 2 })), j({ a: 1 }));
  assert.equal(mergeValues(P + "goal", "not json", j({ a: 2 })), "not json");
  assert.equal(mergeValues(P + "plan", undefined, "{}"), "{}");
});
