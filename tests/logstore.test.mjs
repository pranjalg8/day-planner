import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const ls = await import("../logstore.js");
beforeEach(() => store.clear());

test("dateKey pads", () => assert.equal(ls.dateKey(new Date(2026, 0, 5)), "2026-01-05"));

test("getLog defaults and updateLog merges", () => {
  assert.deepEqual(ls.getLog("2026-01-01"), { weight: null, water: 0, steps: null, sets: {} });
  ls.updateLog("2026-01-01", { water: 1 });
  ls.updateLog("2026-01-01", { steps: 500 });
  assert.deepEqual(ls.getLog("2026-01-01"), { weight: null, water: 1, steps: 500, sets: {} });
});

test("setWeight validates", () => {
  assert.equal(ls.setWeight("d", "72.5").weight, 72.5);
  assert.equal(ls.setWeight("d", "abc").weight, null);
  assert.equal(ls.setWeight("d", -3).weight, null);
});

test("addWater never goes below zero", () => {
  ls.addWater("d", 0.5);
  assert.equal(ls.addWater("d", -2).water, 0);
});

test("setSteps floors and rejects blank/negative", () => {
  assert.equal(ls.setSteps("d", "1234.9").steps, 1234);
  assert.equal(ls.setSteps("d", "").steps, null);
  assert.equal(ls.setSteps("d", -1).steps, null);
});

test("setSetsDone clamps and keeps other exercises", () => {
  ls.setSetsDone("d", 0, 2);
  assert.deepEqual(ls.setSetsDone("d", 1, -4).sets, { 0: 2, 1: 0 });
});

test("weightHistory sorted, limited, ignores non-numeric", () => {
  ls.setWeight("2026-01-03", 70); ls.setWeight("2026-01-01", 72); ls.setWeight("2026-01-02", 71);
  ls.updateLog("2026-01-04", { water: 1 });
  assert.deepEqual(ls.weightHistory(2), [{ date: "2026-01-02", kg: 71 }, { date: "2026-01-03", kg: 70 }]);
});

test("meds taken set/unset and corrupt storage", () => {
  ls.setTaken("d", "a", true); ls.setTaken("d", "b", true); ls.setTaken("d", "a", false);
  assert.deepEqual([...ls.getTaken("d")], ["b"]);
  store.set(ls.MEDS_KEY, "{bad");
  assert.equal(ls.getTaken("d").size, 0);
  store.set(ls.LOG_KEY, "{bad");
  assert.equal(ls.getLog("d").water, 0);
});
