import test from "node:test";
import assert from "node:assert/strict";
import { createMockServer } from "../syncadapter-mock.js";
import { createHttpAdapter } from "../syncadapter-http.js";

const mk = (clock = { t: 1000 }) => ({ clock, srv: createMockServer({ now: () => clock.t, iterations: 100 }) });
const rejects = async (p, code) => assert.rejects(p, (e) => e.code === code);
const doc = (key, updatedAt, deviceId = "d1", value = "{}") => ({ key, value, updatedAt, deviceId });

test("signup validation, uniqueness (case-insensitive), generic login errors", async () => {
  const { srv } = mk(); const a = srv.adapter;
  await rejects(a.signup("a", "1234"), "invalid");
  await rejects(a.signup("Alice", "12"), "invalid");
  await rejects(a.signup("Alice", "abcd"), "invalid");
  const s = await a.signup("  Alice ", "1234");
  assert.equal(s.name, "Alice"); assert.ok(s.token && s.expiresAt > 1000);
  await rejects(a.signup("ALICE", "9999"), "name_taken");
  const bad1 = await a.login("Alice", "0000").catch((e) => e);
  const bad2 = await a.login("nobody", "0000").catch((e) => e);
  assert.equal(bad1.code, "unauthorized"); assert.equal(bad1.message, "Name or PIN is wrong");
  assert.equal(bad2.message, bad1.message);
  assert.equal((await a.login("alice", "1234")).name, "Alice");
});

test("PIN stored only as salted hash", async () => {
  const { srv } = mk();
  await srv.adapter.signup("Bob", "4321"); await srv.adapter.signup("Bob2", "4321");
  const r1 = srv._userRecord("bob"), r2 = srv._userRecord("bob2");
  assert.ok(!JSON.stringify(r1).includes("4321"));
  assert.notEqual(r1.hash, r2.hash); assert.notEqual(r1.salt, r2.salt);
});

test("lockout after 5 wrong attempts for 5 minutes, even for the right PIN", async () => {
  const { srv, clock } = mk(); const a = srv.adapter;
  await a.signup("Carol", "1111");
  for (let i = 0; i < 4; i++) await rejects(a.login("Carol", "2222"), "unauthorized");
  const e = await a.login("Carol", "2222").catch((x) => x);
  assert.equal(e.code, "locked"); assert.equal(e.retryAfterSec, 300);
  const e2 = await a.login("Carol", "1111").catch((x) => x);
  assert.equal(e2.code, "locked"); assert.ok(e2.retryAfterSec <= 300);
  clock.t += 5 * 60 * 1000 + 1;
  assert.equal((await a.login("Carol", "1111")).name, "Carol");
});

test("token expiry -> unauthorized; bad token -> unauthorized", async () => {
  const { srv, clock } = mk(); const a = srv.adapter;
  const s = await a.signup("Dan", "1111");
  await a.getDocs(s.token, null);
  clock.t = s.expiresAt + 1;
  await rejects(a.getDocs(s.token, null), "unauthorized");
  await rejects(a.putDocs("nope", []), "unauthorized");
});

test("putDocs: newer wins, stale rejected with current, equal ts tie by deviceId, legacy 0 never beats", async () => {
  const { srv } = mk(); const a = srv.adapter;
  const { token } = await a.signup("Eve", "1111");
  let r = await a.putDocs(token, [doc("k", 10, "a", "1")]);
  assert.deepEqual(r.accepted, [{ key: "k", serverUpdatedAt: 10 }]);
  r = await a.putDocs(token, [doc("k", 5, "b", "2")]);
  assert.equal(r.rejected[0].current.value, "1");
  r = await a.putDocs(token, [doc("k", 10, "b", "3")]);
  assert.equal(r.accepted.length, 1);
  r = await a.putDocs(token, [doc("k", 10, "a", "4")]);
  assert.equal(r.rejected.length, 1);
  r = await a.putDocs(token, [doc("z", 0, "a", "5")]);
  assert.equal(r.accepted.length, 1);
  r = await a.putDocs(token, [doc("z", 0, "zzz", "6")]);
  assert.equal(r.rejected.length, 1);
});

test("putDocs caps: 25 per batch, 64 KB value; tombstones returned", async () => {
  const { srv } = mk(); const a = srv.adapter;
  const { token } = await a.signup("Fay", "1111");
  await rejects(a.putDocs(token, Array.from({ length: 26 }, (_, i) => doc("k" + i, 1))), "invalid");
  const r = await a.putDocs(token, [doc("big", 1, "a", "x".repeat(65537)), doc("ok", 1, "a", "x".repeat(65536))]);
  assert.equal(r.rejected[0].reason, "too_large"); assert.equal(r.accepted.length, 1);
  await a.putDocs(token, [{ key: "ok", updatedAt: 2, deviceId: "a", deleted: true }]);
  const g = await a.getDocs(token, null);
  assert.equal(g.docs.find((d) => d.key === "ok").deleted, true);
});

test("getDocs: cursor paging is monotonic and per-user", async () => {
  const { srv } = mk(); const a = srv.adapter;
  const u1 = await a.signup("U1", "1111"), u2 = await a.signup("U2", "1111");
  await a.putDocs(u1.token, Array.from({ length: 25 }, (_, i) => doc("k" + i, 1)));
  await a.putDocs(u1.token, Array.from({ length: 5 }, (_, i) => doc("m" + i, 1)));
  const p1 = await a.getDocs(u1.token, null, 20);
  assert.equal(p1.docs.length, 20); assert.equal(p1.hasMore, true);
  const p2 = await a.getDocs(u1.token, p1.cursor, 20);
  assert.equal(p2.docs.length, 10); assert.equal(p2.hasMore, false);
  const p3 = await a.getDocs(u1.token, p2.cursor);
  assert.equal(p3.docs.length, 0);
  await a.putDocs(u1.token, [doc("k0", 2)]);
  assert.deepEqual((await a.getDocs(u1.token, p2.cursor)).docs.map((d) => d.key), ["k0"]);
  assert.equal((await a.getDocs(u2.token, null)).docs.length, 0);
  await rejects(a.getDocs(u1.token, "garbage"), "invalid");
  await a.deleteAccountData(u1.token);
  assert.equal((await a.getDocs(u1.token, null)).docs.length, 0);
});

test("failure simulation", async () => {
  const { srv } = mk();
  srv.setOffline(true);
  await rejects(srv.adapter.signup("Gus", "1111"), "network");
  srv.clearFailures();
  srv.failNext(1);
  await rejects(srv.adapter.signup("Gus", "1111"), "network");
  assert.ok((await srv.adapter.signup("Gus", "1111")).token);
});

// ---- HTTP adapter against a stubbed fetch ----
function stubFetch(status, body, headers = {}) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); if (status === "throw") throw new TypeError("fail"); return { status, headers: { get: (h) => headers[h] ?? null }, json: async () => { if (body === undefined) throw new Error("no body"); return body; } }; };
  f.calls = calls; return f;
}
const http = (f) => createHttpAdapter({ baseUrl: "https://api.example.com/", clientId: "day-planner", fetchImpl: f });

test("http: requests are shaped per contract", async () => {
  const f = stubFetch(201, { token: "t", expiresAt: 5, name: "A" });
  const r = await http(f).signup("A", "1234");
  assert.equal(r.token, "t");
  assert.equal(f.calls[0].url, "https://api.example.com/v1/day-planner/auth/signup");
  assert.equal(f.calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { name: "A", pin: "1234" });
  const g = stubFetch(200, { docs: [], cursor: "c", hasMore: false });
  await http(g).getDocs("tok", "c1", 50);
  assert.equal(g.calls[0].url, "https://api.example.com/v1/day-planner/docs?limit=50&cursor=c1");
  assert.equal(g.calls[0].init.headers.Authorization, "Bearer tok");
  const p = stubFetch(200, { accepted: [], rejected: [] });
  await http(p).putDocs("tok", [{ key: "k" }]);
  assert.equal(p.calls[0].init.method, "PUT");
  assert.match(p.calls[0].url, /\/docs\/batch$/);
  const d = stubFetch(204);
  await http(d).deleteAccountData("tok");
  assert.equal(d.calls[0].init.method, "DELETE");
  assert.match(d.calls[0].url, /\/account\/data$/);
});

test("http: status -> error code mapping", async () => {
  const code = async (status, body, fn = (a) => a.login("A", "1234"), headers) => (await fn(http(stubFetch(status, body, headers))).catch((e) => e));
  assert.equal((await code(400, { message: "bad" })).code, "invalid");
  const u = await code(401, { message: "custom" });
  assert.equal(u.code, "unauthorized"); assert.equal(u.message, "Name or PIN is wrong");
  assert.equal((await code(401, {}, (a) => a.getDocs("t", null))).code, "unauthorized");
  assert.equal((await code(409, {}, (a) => a.signup("A", "1234"))).code, "name_taken");
  const l = await code(429, { retryAfterSec: 120 });
  assert.equal(l.code, "locked"); assert.equal(l.retryAfterSec, 120);
  assert.equal((await code(429, undefined, undefined, { "Retry-After": "30" })).retryAfterSec, 30);
  assert.equal((await code(500, {})).code, "network");
  assert.equal((await code("throw")).code, "network");
  assert.equal((await code(200, undefined)).code, "network");
});

test("http: uses global fetch when none injected", async () => {
  const orig = globalThis.fetch; const f = stubFetch(200, { docs: [], cursor: "c", hasMore: false });
  globalThis.fetch = f;
  try { await createHttpAdapter({ baseUrl: "https://x.test", clientId: "day-planner" }).getDocs("t", null); } finally { globalThis.fetch = orig; }
  assert.equal(f.calls.length, 1);
});
