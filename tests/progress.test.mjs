import test from "node:test";
import assert from "node:assert/strict";
import { loadHistory, saveHistory, recordDay, completionRatio, computeStreak, HISTORY_KEY } from "../progress.js";

function mem(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

test("recordDay is immutable and completionRatio handles empty", () => {
  const h = {};
  const h2 = recordDay(h, "2026-01-01", 3, 4);
  assert.deepEqual(h, {});
  assert.equal(completionRatio(h2["2026-01-01"]), 0.75);
  assert.equal(completionRatio(undefined), 0);
  assert.equal(completionRatio({ done: 0, total: 0 }), 0);
});

test("save/load round trip and corrupt storage", () => {
  const s = mem();
  saveHistory({ "2026-01-01": { done: 1, total: 2 } }, s);
  assert.deepEqual(loadHistory(s), { "2026-01-01": { done: 1, total: 2 } });
  assert.deepEqual(loadHistory(mem({ [HISTORY_KEY]: "{oops" })), {});
  assert.deepEqual(loadHistory(mem({ [HISTORY_KEY]: "[1]" })), {});
  assert.doesNotThrow(() => saveHistory({}, { setItem() { throw new Error("full"); } }));
});

test("computeStreak counts back from today or yesterday, across month/year boundaries", () => {
  const good = { done: 9, total: 10 };
  const h = { "2025-12-30": good, "2025-12-31": good, "2026-01-01": good, "2026-01-02": good };
  assert.equal(computeStreak(h, "2026-01-02"), 4);
  assert.equal(computeStreak(h, "2026-01-03"), 4, "today not yet done falls back to yesterday");
  assert.equal(computeStreak(h, "2026-01-04"), 0);
  assert.equal(computeStreak({ ...h, "2026-01-01": { done: 7, total: 10 } }, "2026-01-02"), 1);
  assert.equal(computeStreak({}, "2026-01-02"), 0);
});

test("leap day shifts correctly", () => {
  const good = { done: 1, total: 1 };
  assert.equal(computeStreak({ "2028-02-28": good, "2028-02-29": good, "2028-03-01": good }, "2028-03-01"), 3);
});
