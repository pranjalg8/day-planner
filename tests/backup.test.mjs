import test from "node:test";
import assert from "node:assert/strict";

function stubStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}
globalThis.localStorage = stubStorage();
const B = await import("../backup.js");

const day = (d) => [`elevate-planner:2026-10-${String(d).padStart(2, "0")}`, JSON.stringify({ done: ["a"], overrides: {} })];
const sample = () => Object.fromEntries([
  day(1), day(2), day(3),
  ["elevate-planner:log", JSON.stringify({ "2026-10-01": { weight: 80 }, "2026-10-02": { water: 3 }, "2026-10-03": { weight: 79.5 } })],
  ["elevate-planner:plan", "{}"],
]);

test("summarizeData counts days, weigh-ins, plan", () => {
  const s = B.summarizeData(sample());
  assert.equal(s.days, 3);
  assert.equal(s.weighIns, 2);
  assert.equal(s.logDays, 3);
  assert.equal(s.hasPlan, true);
  assert.deepEqual(B.summarizeData({}), { days: 0, weighIns: 0, logDays: 0, hasPlan: false, keys: 0 });
  assert.equal(B.summarizeData(null).days, 0);
  assert.equal(B.summarizeData({ "elevate-planner:log": "not json" }).weighIns, 0);
  assert.match(B.describeSummary(B.summarizeData(sample())), /3 days.*2 weigh-ins/);
  assert.match(B.describeSummary({ days: 1, weighIns: 0, logDays: 0, hasPlan: false }), /^1 day of/);
});

test("daysSince and label", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  assert.equal(B.daysSince("2026-10-06T12:00:00Z", now), 3);
  assert.equal(B.daysSince("2026-10-09T01:00:00Z", now), 0);
  assert.equal(B.daysSince(null, now), null);
  assert.equal(B.daysSince("garbage", now), null);
  assert.equal(B.lastBackupLabel(null, now), "Never backed up");
  assert.match(B.lastBackupLabel("2026-10-06T12:00:00Z", now), /^Last backed up: 3 days ago \(/);
  assert.match(B.lastBackupLabel("2026-10-09T01:00:00Z", now), /today/);
  assert.match(B.lastBackupLabel("2026-10-08T01:00:00Z", now), /yesterday/);
});

test("needsBackup thresholds, never, and snooze", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  const summary = B.summarizeData(sample());
  const few = B.summarizeData({ ...Object.fromEntries([day(1), day(2)]) });
  assert.equal(B.needsBackup({ summary: few, lastBackup: null, now }), false);
  assert.equal(B.needsBackup({ summary, lastBackup: null, now }), true);
  assert.equal(B.needsBackup({ summary, lastBackup: "2026-10-03T12:00:00Z", now }), false); // 6 days
  assert.equal(B.needsBackup({ summary, lastBackup: "2026-10-02T12:00:00Z", now }), true); // 7 days
  assert.equal(B.needsBackup({ summary, lastBackup: null, snoozeUntil: "2026-10-10T00:00:00Z", now }), false);
  assert.equal(B.needsBackup({ summary, lastBackup: null, snoozeUntil: "2026-10-09T00:00:00Z", now }), true);
});

test("ui keys are not exported and snooze lasts 2 days", () => {
  globalThis.localStorage = stubStorage(sample());
  B.markBackedUp(new Date("2026-10-09T00:00:00Z"));
  B.snoozeBackupNudge(new Date("2026-10-09T00:00:00Z"));
  assert.equal(B.getLastBackup(), "2026-10-09T00:00:00.000Z");
  assert.equal(B.getSnoozeUntil(), "2026-10-11T00:00:00.000Z");
  assert.ok(Object.keys(B.collectData()).every((k) => k.startsWith("elevate-planner:")));
});

test("snapshot then import then undo restores the previous data", () => {
  const before = sample();
  globalThis.localStorage = stubStorage(before);
  assert.equal(B.readSnapshot(), null);
  assert.equal(B.undoImport(), false);
  assert.equal(B.saveSnapshot(), true);
  B.restoreData({ "elevate-planner:2026-01-01": "{}" });
  assert.deepEqual(Object.keys(B.collectData()), ["elevate-planner:2026-01-01"]);
  assert.ok(B.readSnapshot());
  assert.equal(B.undoImport(), true);
  assert.deepEqual(B.collectData(), before);
  assert.equal(B.readSnapshot(), null);
});

test("saveSnapshot reports storage failure; corrupt snapshot ignored", () => {
  const st = stubStorage(sample());
  globalThis.localStorage = st;
  st.setItem = () => { throw new Error("quota"); };
  assert.equal(B.saveSnapshot(), false);
  globalThis.localStorage = stubStorage({ [B.SNAPSHOT_KEY]: "{oops" });
  assert.equal(B.readSnapshot(), null);
  globalThis.localStorage = stubStorage({ [B.SNAPSHOT_KEY]: JSON.stringify({ data: { "other:x": "1" } }) });
  assert.equal(B.readSnapshot(), null);
});

test("parseBackupText validates and keeps format v1", () => {
  const good = JSON.stringify({ format: "elevate-planner-backup", version: 1, exportedAt: "2026-10-01T00:00:00Z", data: sample() });
  const r = B.parseBackupText(good);
  assert.equal(r.exportedAt, "2026-10-01T00:00:00Z");
  assert.equal(Object.keys(r.data).length, 5);
  assert.throws(() => B.parseBackupText("nope"), /not valid JSON/);
  assert.throws(() => B.parseBackupText("{}"), /Not a Day Planner/);
  assert.throws(() => B.parseBackupText(JSON.stringify({ format: "elevate-planner-backup", version: 1, data: { "x:y": "1" } })), /Unexpected key/);
});
