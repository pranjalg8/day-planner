import test from "node:test";
import assert from "node:assert/strict";
import { computeDay } from "../engine.js";
import { findMissed, missedHint, GENERIC_MISSED_HINT } from "../missed.js";
import { markDone, unmarkDone, parseDeepLink, parseDateKey } from "../actions.js";

const day = new Date("2026-09-24T12:00:00"); // in course
const items = computeDay(day, {}, new Set());

test("findMissed: only unchecked, passed medicines today", () => {
  const m = findMissed(items, { isToday: true, isPast: false, nowMin: 12 * 60 });
  assert.ok(m.length > 0);
  assert.ok(m.every((i) => i.category === "medicine" && i.minutes < 720 && !i.done));
  assert.equal(findMissed(items, { isToday: false, isPast: false, nowMin: 1400 }).length, 0);
  const past = findMissed(items, { isToday: false, isPast: true, nowMin: 0 });
  assert.equal(past.length, items.filter((i) => i.category === "medicine").length);
});

test("findMissed skips done items", () => {
  const ids = new Set(items.filter((i) => i.category === "medicine").map((i) => i.id));
  const done = computeDay(day, {}, ids);
  assert.equal(findMissed(done, { isToday: false, isPast: true, nowMin: 0 }).length, 0);
});

test("missedHint: data-driven with generic fallback", () => {
  assert.match(missedHint("stable-n-fit-am"), /30 min after food/);
  assert.equal(missedHint("l-carnitine-am"), GENERIC_MISSED_HINT);
  assert.equal(missedHint("x", [{ id: "x", missedHint: "custom" }]), "custom");
});

test("markDone/unmarkDone are immutable and idempotent", () => {
  const s = { overrides: { a: 1 }, done: ["x"] };
  const s2 = markDone(markDone(s, "y"), "y");
  assert.deepEqual(s2.done, ["x", "y"]);
  assert.deepEqual(s.done, ["x"]);
  assert.deepEqual(unmarkDone(s2, "x").done, ["y"]);
  assert.deepEqual(s2.overrides, { a: 1 });
});

test("parseDeepLink validates input", () => {
  assert.deepEqual(parseDeepLink("?tab=log"), { tab: "log" });
  assert.deepEqual(parseDeepLink("?done=stable-n-fit-am&date=2026-09-24"), { done: "stable-n-fit-am", date: "2026-09-24" });
  assert.deepEqual(parseDeepLink("?tab=<x>&done=a b&date=bad"), {});
  assert.deepEqual(parseDeepLink(""), {});
});

test("parseDateKey", () => {
  assert.equal(parseDateKey("2026-09-24").getDate(), 24);
  assert.equal(parseDateKey("nope"), null);
});
