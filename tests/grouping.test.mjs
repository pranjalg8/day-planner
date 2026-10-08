import test from "node:test";
import assert from "node:assert/strict";
import { blockIdFor, groupItems } from "../grouping.js";

const it = (id, minutes, done = false) => ({ id, minutes, done });

test("blockIdFor by time and workout ids", () => {
  assert.equal(blockIdFor(it("a", 0)), "morning");
  assert.equal(blockIdFor(it("a", 479)), "morning");
  assert.equal(blockIdFor(it("a", 480)), "breakfast");
  assert.equal(blockIdFor(it("a", 700)), "lunch");
  assert.equal(blockIdFor(it("a", 1000)), "afternoon");
  assert.equal(blockIdFor(it("a", 1200)), "dinner");
  assert.equal(blockIdFor(it("a", 1300)), "night");
  assert.equal(blockIdFor(it("workout-warmup", 420)), "workout");
  assert.equal(blockIdFor(it("workout-3", 430)), "workout");
  assert.equal(blockIdFor(it("workout-x", 430)), "morning");
});

test("groupItems groups, counts, orders and omits empty blocks", () => {
  const blocks = groupItems([
    it("wake", 400, true), it("workout-warmup", 420, true), it("workout-0", 425),
    it("bf", 500), it("dinner", 1150, true), it("late", 1300),
  ]);
  assert.deepEqual(blocks.map((b) => b.id), ["morning", "workout", "breakfast", "dinner", "night"]);
  const w = blocks.find((b) => b.id === "workout");
  assert.equal(w.count, 2);
  assert.equal(w.doneCount, 1);
  assert.equal(w.startMinutes, 420);
  assert.deepEqual(groupItems([]), []);
});
