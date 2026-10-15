import test from "node:test";
import assert from "node:assert/strict";
import { createMockServer } from "../syncadapter-mock.js";
import { createSyncEngine, installWriteTracking, BATCH_SIZE } from "../syncengine.js";
import { readMeta, SESSION_KEY, SNAPSHOT_KEY, META_KEY } from "../syncstore.js";
import { stubStorage, fakeClock, settle } from "./synchelpers.mjs";

const P = "elevate-planner:";
const day = (n) => `${P}2026-10-${String(n).padStart(2, "0")}`;
const dv = (done, overrides = {}) => JSON.stringify({ done, overrides });

function world() {
  const clock = fakeClock();
  const srv = createMockServer({ now: clock.now, iterations: 50 });
  let n = 0;
  function device(id, init = {}, extra = {}) {
    const storage = stubStorage(init);
    storage._map.set("day-planner-sync:deviceId", id);
    const engine = createSyncEngine({ storage, adapter: extra.adapter || srv.adapter, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, target: null, doc: null });
    return { storage, engine, id, i: n++ };
  }
  return { clock, srv, device };
}
const val = (d, k) => d.storage.getItem(k);

test("signup/login errors are surfaced; PIN never stored", async () => {
  const { device } = world();
  const a = device("a");
  await assert.rejects(a.engine.signup("x", "1234"), (e) => e.code === "invalid");
  await assert.rejects(a.engine.signup("Alice", "12"), (e) => e.code === "invalid");
  await a.engine.signup("Alice", "123456");
  const b = device("b");
  await assert.rejects(b.engine.signup("alice", "1111"), (e) => e.code === "name_taken");
  await assert.rejects(b.engine.login("Alice", "9999"), (e) => e.code === "unauthorized" && e.message === "Name or PIN is wrong");
  assert.equal(b.engine.getState().status, "signed-out");
  const dump = JSON.stringify([...a.storage._map.entries()]);
  assert.ok(!dump.includes("123456"));
  assert.deepEqual(Object.keys(JSON.parse(a.storage.getItem(SESSION_KEY))).sort(), ["expiresAt", "name", "token"]);
});

test("lockout surfaces code locked with retryAfterSec", async () => {
  const { device } = world();
  const a = device("a"); await a.engine.signup("Lock", "1111");
  const b = device("b");
  let e;
  for (let i = 0; i < 5; i++) e = await b.engine.login("Lock", "2222").catch((x) => x);
  assert.equal(e.code, "locked"); assert.ok(e.retryAfterSec > 0);
});

test("no adapter -> status off; signup fails", async () => {
  const storage = stubStorage();
  const eng = createSyncEngine({ storage, adapter: null, now: () => 1 });
  assert.equal(eng.getState().status, "off");
  await assert.rejects(eng.signup("Alice", "1234"));
});

test("write tracking: only elevate-planner keys, idempotent, removal = tombstone", async () => {
  const { device, clock } = world();
  const d = device("a");
  const s = d.storage;
  const set1 = s.setItem;
  installWriteTracking(s); installWriteTracking(s);
  assert.equal(s.setItem, set1);
  s.setItem("other", "1"); s.setItem("day-planner-ui:x", "1");
  s.setItem(day(1), "{}");
  let m = readMeta(s);
  assert.deepEqual(Object.keys(m.dirty), [day(1)]);
  assert.equal(m.updatedAt[day(1)], clock.t);
  s.setItem(day(1), "{}"); // unchanged value: no re-stamp
  clock.t += 5; s.setItem(day(1), '{"a":1}');
  assert.equal(readMeta(s).updatedAt[day(1)], clock.t);
  s.removeItem(day(1)); s.removeItem(day(1));
  m = readMeta(s);
  assert.ok(m.dirty[day(1)]); assert.equal(s.getItem(day(1)), null);
  assert.equal(d.engine.getState().pending, 1);
});

test("restoreData-style remove then set dedupes to final state", async () => {
  const { device, srv } = world();
  const d = device("a");
  await d.engine.signup("Rae", "1111");
  d.storage.setItem(day(1), dv(["a"])); d.storage.setItem(day(2), dv(["b"]));
  await d.engine.syncNow();
  assert.equal(readMeta(d.storage).dirty[day(1)], undefined);
  // restore: remove everything, set only day 2 (new value) and day 3
  for (const k of [day(1), day(2)]) d.storage.removeItem(k);
  d.storage.setItem(day(2), dv(["z"])); d.storage.setItem(day(3), dv(["c"]));
  assert.deepEqual(Object.keys(readMeta(d.storage).dirty).sort(), [day(1), day(2), day(3)]);
  await d.engine.syncNow();
  const docs = (await srv.adapter.getDocs((await srv.adapter.login("Rae", "1111")).token, null)).docs;
  const by = Object.fromEntries(docs.map((x) => [x.key, x]));
  assert.equal(by[day(1)].deleted, true);
  assert.equal(by[day(2)].value, dv(["z"]));
  assert.equal(by[day(3)].value, dv(["c"]));
});

test("push batching over 25 docs", async () => {
  const { device, srv } = world();
  const d = device("a");
  await d.engine.signup("Bat", "1111");
  for (let i = 0; i < 60; i++) d.storage.setItem(`${P}k${i}`, "{}");
  const before = srv.stats.putCalls;
  await d.engine.syncNow();
  assert.equal(srv.stats.putCalls - before, Math.ceil(60 / BATCH_SIZE));
  assert.equal(srv.docCount("Bat"), 60);
  assert.equal(d.engine.getState().pending, 0);
});

test("debounce: writes re-arm one timer; push after 20s; no real waiting", async () => {
  const { device, srv, clock } = world();
  const d = device("a");
  await d.engine.signup("Deb", "1111");
  d.engine.start();
  await settle();
  const puts = () => srv.stats.putCalls;
  const p0 = puts();
  d.storage.setItem(day(1), dv(["a"]));
  clock.advance(15000);
  d.storage.setItem(day(1), dv(["a", "b"]));
  clock.advance(15000);
  await settle();
  assert.equal(puts(), p0, "still debouncing");
  clock.advance(6000);
  await settle();
  assert.equal(puts(), p0 + 1);
  assert.equal(srv.docCount("Deb"), 1);
  assert.equal(d.engine.getState().pending, 0);
  d.engine.stop();
});

test("offline then online: exponential backoff, queue survives reload", async () => {
  const { device, srv, clock } = world();
  const d = device("a");
  await d.engine.signup("Off", "1111");
  d.storage.setItem(day(1), dv(["a"]));
  srv.setOffline(true);
  await d.engine.syncNow();
  let s = d.engine.getState();
  assert.equal(s.status, "offline"); assert.equal(s.pending, 1);
  clock.advance(5000); await settle();            // retry 1 fails -> 10s
  clock.advance(5000); await settle();
  assert.equal(d.engine.getState().status, "offline");
  // "reload": new engine on same storage
  const d2 = createSyncEngine({ storage: d.storage, adapter: srv.adapter, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, target: null, doc: null });
  assert.equal(d2.getState().pending, 1);
  srv.setOffline(false);
  clock.advance(300000); await settle();
  assert.equal(d.engine.getState().pending, 0);
  assert.equal(d.engine.getState().status, "idle");
  assert.equal(srv.docCount("Off"), 1);
});

test("backoff caps at 5 minutes", async () => {
  const { device, srv, clock } = world();
  const d = device("a");
  await d.engine.signup("Cap", "1111");
  d.storage.setItem(day(1), "{}");
  srv.setOffline(true);
  await d.engine.syncNow();
  for (let i = 0; i < 12; i++) { clock.advance(300000); await settle(); }
  const calls = srv.stats.getCalls;
  clock.advance(299000); await settle();
  assert.equal(srv.stats.getCalls, calls);
  assert.equal(clock.timers.length, 1);
  assert.ok(clock.timers[0].at - clock.t <= 1000);
});

test("online event triggers sync, resetting backoff", async () => {
  const clock = fakeClock(); const srv = createMockServer({ now: clock.now, iterations: 50 });
  const target = new EventTarget();
  const storage = stubStorage();
  const eng = createSyncEngine({ storage, adapter: srv.adapter, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, target, doc: null });
  await eng.signup("Onl", "1111");
  eng.start();
  storage.setItem(day(1), "{}");
  srv.setOffline(true); await eng.syncNow();
  srv.setOffline(false);
  target.dispatchEvent(new Event("online")); await settle();
  assert.equal(eng.getState().pending, 0);
  eng.stop();
});

test("visibility hidden flushes pushes; visible pulls", async () => {
  const clock = fakeClock(); const srv = createMockServer({ now: clock.now, iterations: 50 });
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const storage = stubStorage();
  const eng = createSyncEngine({ storage, adapter: srv.adapter, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, target: null, doc });
  await eng.signup("Vis", "1111"); eng.start(); await settle();
  storage.setItem(day(1), "{}");
  doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); await settle();
  assert.equal(srv.docCount("Vis"), 1);
  const g = srv.stats.getCalls;
  doc.visibilityState = "visible"; doc.dispatchEvent(new Event("visibilitychange")); await settle();
  assert.ok(srv.stats.getCalls > g);
  eng.stop();
});

test("token expiry -> signed-out, local data untouched", async () => {
  const { device, srv } = world();
  const d = device("a");
  await d.engine.signup("Exp", "1111");
  d.storage.setItem(day(1), dv(["a"]));
  srv.expireTokens();
  await d.engine.syncNow();
  const s = d.engine.getState();
  assert.equal(s.status, "signed-out");
  assert.equal(d.storage.getItem(SESSION_KEY), null);
  assert.equal(val(d, day(1)), dv(["a"]));
});

test("logout keeps local data; deleteCloudData keeps local data", async () => {
  const { device, srv } = world();
  const d = device("a");
  await d.engine.signup("Out", "1111");
  d.storage.setItem(day(1), dv(["a"])); await d.engine.syncNow();
  assert.equal(srv.docCount("Out"), 1);
  await d.engine.deleteCloudData();
  assert.equal(srv.docCount("Out"), 0);
  assert.equal(val(d, day(1)), dv(["a"]));
  d.engine.logout();
  assert.equal(d.engine.getState().status, "signed-out");
  assert.equal(val(d, day(1)), dv(["a"]));
  assert.equal(d.storage.getItem(SESSION_KEY), null);
});

test("two devices converge: A writes, B pulls; same key: higher updatedAt wins", async () => {
  const { device, clock } = world();
  const A = device("a"), B = device("b");
  await A.engine.signup("Duo", "1111");
  await B.engine.login("Duo", "1111");
  A.storage.setItem(day(1), dv(["x"])); await A.engine.syncNow();
  await B.engine.syncNow();
  assert.equal(val(B, day(1)), dv(["x"]));
  assert.equal(readMeta(B.storage).dirty[day(1)], undefined, "pulled docs must not re-dirty");
  clock.t += 100; A.storage.setItem(day(1), dv(["x", "A"]));
  clock.t += 100; B.storage.setItem(day(1), dv(["x", "B"]));
  await A.engine.syncNow(); await B.engine.syncNow(); await A.engine.syncNow();
  assert.equal(val(A, day(1)), dv(["x", "B"]));
  assert.equal(val(B, day(1)), dv(["x", "B"]));
});

test("same updatedAt: higher deviceId wins on both", async () => {
  const { device } = world();
  const A = device("aaa"), B = device("zzz");
  await A.engine.signup("Tie", "1111"); await B.engine.login("Tie", "1111");
  A.storage.setItem(day(1), dv(["A"])); B.storage.setItem(day(1), dv(["B"]));
  assert.equal(readMeta(A.storage).updatedAt[day(1)], readMeta(B.storage).updatedAt[day(1)]);
  await A.engine.syncNow(); await B.engine.syncNow(); await A.engine.syncNow();
  assert.equal(val(A, day(1)), dv(["B"])); assert.equal(val(B, day(1)), dv(["B"]));
});

test("tombstones propagate", async () => {
  const { device, clock } = world();
  const A = device("a"), B = device("b");
  await A.engine.signup("Tomb", "1111"); await B.engine.login("Tomb", "1111");
  A.storage.setItem(day(1), "{}"); await A.engine.syncNow(); await B.engine.syncNow();
  assert.ok(val(B, day(1)));
  clock.t += 50; A.storage.removeItem(day(1)); await A.engine.syncNow(); await B.engine.syncNow();
  assert.equal(val(B, day(1)), null);
  assert.equal(readMeta(B.storage).dirty[day(1)], undefined);
});

test("new device pulls a large history over several pages", async () => {
  const { device, srv } = world();
  const A = device("a");
  await A.engine.signup("Big", "1111");
  for (let i = 0; i < 450; i++) A.storage.setItem(`${P}h${i}`, JSON.stringify({ i }));
  await A.engine.syncNow();
  const B = device("b");
  const g0 = srv.stats.getCalls;
  await B.engine.login("Big", "1111");
  assert.ok(srv.stats.getCalls - g0 >= 3);
  assert.equal(B.engine.countLocalDocs().hasOther, true);
  for (let i = 0; i < 450; i += 77) assert.equal(val(B, `${P}h${i}`), JSON.stringify({ i }));
  assert.equal(readMeta(B.storage).dirty[`${P}h5`], undefined);
  assert.equal(B.engine.getState().pending, 0);
});

test("onApplied reports keys written from remote", async () => {
  const { device } = world();
  const A = device("a"), B = device("b");
  await A.engine.signup("App", "1111"); await B.engine.login("App", "1111");
  const seen = []; B.engine.onApplied((k) => seen.push(...k));
  A.storage.setItem(day(1), "{}"); await A.engine.syncNow(); await B.engine.syncNow();
  assert.deepEqual(seen, [day(1)]);
});

// ---- first link / legacy merge ----
test("legacy: phone links first, Mac with overlapping legacy data converges to the union", async () => {
  const { device, srv, clock } = world();
  const phone = device("phone", {
    [day(1)]: dv(["a", "b"], { x: 1 }),
    [P + "log"]: JSON.stringify({ "2026-10-01": { weight: 80, water: 3, steps: null, sets: {} } }),
    [P + "plan"]: JSON.stringify({ who: "phone" }),
  });
  await phone.engine.signup("Linky", "1111");
  assert.equal(srv.docCount("Linky"), 3);
  assert.ok(phone.storage.getItem(SNAPSHOT_KEY), "snapshot before first link");

  const mac = device("mac", {
    [day(1)]: dv(["b", "c"], { x: 9, y: 2 }),
    [day(2)]: dv(["m"]),
    [P + "log"]: JSON.stringify({ "2026-10-01": { weight: null, water: 7, steps: 500, sets: {} } }),
    [P + "plan"]: JSON.stringify({ who: "mac" }),
  });
  const info = mac.engine.countLocalDocs();
  assert.deepEqual(info, { days: 2, hasOther: true });
  clock.t += 1000;
  await mac.engine.login("Linky", "1111");
  await phone.engine.syncNow();

  for (const dev of [mac, phone]) {
    const d1 = JSON.parse(val(dev, day(1)));
    assert.deepEqual(d1.done.sort(), ["a", "b", "c"]);
    assert.deepEqual(d1.overrides, { x: 1, y: 2 });
    assert.ok(val(dev, day(2)));
    const l = JSON.parse(val(dev, P + "log"))["2026-10-01"];
    assert.equal(l.water, 7); assert.equal(l.weight, 80); assert.equal(l.steps, 500);
    assert.deepEqual(JSON.parse(val(dev, P + "plan")), { who: "phone" }, "account setup wins");
    assert.equal(dev.engine.getState().pending, 0);
  }
});

test("legacy docs never beat cloud data on push; later edits (stamped now) win normally", async () => {
  const { device, clock } = world();
  const phone = device("phone", { [P + "plan"]: JSON.stringify({ v: "phone" }) });
  await phone.engine.signup("Late", "1111");
  const mac = device("mac");
  await mac.engine.login("Late", "1111");
  clock.t += 1000;
  mac.storage.setItem(P + "plan", JSON.stringify({ v: "mac-edit" }));
  await mac.engine.syncNow(); await phone.engine.syncNow();
  assert.deepEqual(JSON.parse(val(phone, P + "plan")), { v: "mac-edit" });
  // phone's former-legacy doc is no longer legacy: remote edit replaces, not merges
  clock.t += 1000;
  phone.storage.setItem(day(5), dv(["a", "b"]));
  await phone.engine.syncNow(); await mac.engine.syncNow();
  clock.t += 1000;
  mac.storage.setItem(day(5), dv(["a"]));
  await mac.engine.syncNow(); await phone.engine.syncNow();
  assert.equal(val(phone, day(5)), dv(["a"]));
});

test("different account refused without replaceLocal; snapshot + restore works", async () => {
  const { device, srv } = world();
  const other = device("o");
  await other.engine.signup("Zed", "2222");
  other.storage.setItem(day(9), dv(["zed"])); await other.engine.syncNow();

  const d = device("d", { [day(1)]: dv(["mine"]), [day(2)]: dv(["mine2"]) });
  await d.engine.signup("Amy", "1111");
  assert.equal(d.engine.getState().linkedName, "amy");
  d.engine.logout();
  const calls = srv.stats.loginCalls;
  const e = await d.engine.login("Zed", "2222").catch((x) => x);
  assert.equal(e.code, "different_account"); assert.equal(e.linkedName, "amy");
  assert.equal(srv.stats.loginCalls, calls, "refused before any network call");
  assert.equal(val(d, day(1)), dv(["mine"]));
  assert.equal(d.engine.getState().status, "signed-out");

  await d.engine.login("Zed", "2222", { replaceLocal: true });
  assert.equal(val(d, day(1)), null);
  assert.equal(val(d, day(9)), dv(["zed"]));
  assert.equal(d.engine.getState().linkedName, "zed");
  assert.deepEqual(Object.keys(JSON.parse(d.storage.getItem(SNAPSHOT_KEY))).sort(), [day(1), day(2)]);

  d.engine.logout();
  assert.equal(d.engine.restorePreLinkSnapshot(), true);
  assert.equal(val(d, day(1)), dv(["mine"])); assert.equal(val(d, day(9)), null);
  assert.equal(d.storage.getItem(SNAPSHOT_KEY), null);
  assert.equal(d.engine.restorePreLinkSnapshot(), false);
  assert.equal(d.engine.getState().linkedName, null);
  await d.engine.login("AMY", "1111");
  assert.equal(d.engine.getState().name, "Amy");
});

test("failed login does not wipe on replaceLocal", async () => {
  const { device } = world();
  const o = device("o"); await o.engine.signup("Kay", "2222");
  const d = device("d", { [day(1)]: dv(["mine"]) });
  await assert.rejects(d.engine.login("Kay", "0000", { replaceLocal: true }), (e) => e.code === "unauthorized");
  assert.equal(val(d, day(1)), dv(["mine"]));
  assert.equal(d.storage.getItem(META_KEY), null);
});
