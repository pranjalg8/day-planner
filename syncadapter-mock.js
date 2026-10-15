// In-memory server + adapter implementing the HTTP contract rules (docs/sync-api.md).
// Used by tests and demos. Works in Node and browsers (PBKDF2 via globalThis.crypto.subtle).
import { syncError } from "./syncstore.js";

export const MAX_BATCH = 25;
export const MAX_VALUE_BYTES = 64 * 1024;
export const MAX_ATTEMPTS = 5;
export const LOCK_MS = 5 * 60 * 1000;
export const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
export const UNAUTHORIZED_MESSAGE = "Name or PIN is wrong";

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const enc = new TextEncoder();
const bytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function hashPin(pin, saltHex, iterations) {
  const key = await globalThis.crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await globalThis.crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export function createMockServer({ now = Date.now, iterations = 20000, tokenTtlMs = TOKEN_TTL_MS } = {}) {
  const users = new Map();    // lower name -> { id, name, salt, hash }
  const docs = new Map();     // userId -> { seq, items: Map(key -> doc + seq) }
  const tokens = new Map();   // token -> { userId, expiresAt }
  const attempts = new Map(); // lower name -> { count, lockedUntil }
  let offline = false, failures = [];
  const stats = { putCalls: 0, getCalls: 0, loginCalls: 0 };

  function gate() {
    if (offline) throw syncError("network", "Network unavailable");
    if (failures.length) { const f = failures.shift(); throw f instanceof Error ? f : syncError(f || "network", "Simulated failure"); }
  }
  function validName(name) {
    const n = typeof name === "string" ? name.trim() : "";
    if (n.length < 2 || n.length > 32) throw syncError("invalid", "Name must be 2 to 32 characters.");
    return n;
  }
  function validPin(pin) {
    if (typeof pin !== "string" || !/^\d{4,8}$/.test(pin)) throw syncError("invalid", "PIN must be 4 to 8 digits.");
    return pin;
  }
  function newSession(user) {
    const token = hex(bytes(32));
    const expiresAt = now() + tokenTtlMs;
    tokens.set(token, { userId: user.id, expiresAt });
    return { token, expiresAt, name: user.name };
  }
  function auth(token) {
    const t = tokens.get(token);
    if (!t || t.expiresAt <= now()) { tokens.delete(token); throw syncError("unauthorized", "Session expired"); }
    if (!docs.has(t.userId)) docs.set(t.userId, { seq: 0, items: new Map() });
    return docs.get(t.userId);
  }
  const lockedFor = (a) => (a && a.lockedUntil > now() ? Math.ceil((a.lockedUntil - now()) / 1000) : 0);

  const adapter = {
    async signup(name, pin) {
      gate();
      const n = validName(name); validPin(pin);
      const lower = n.toLowerCase();
      if (users.has(lower)) throw syncError("name_taken", "That name is already taken");
      const salt = hex(bytes(16));
      const user = { id: "u" + hex(bytes(8)), name: n, salt, hash: await hashPin(pin, salt, iterations) };
      if (users.has(lower)) throw syncError("name_taken", "That name is already taken");
      users.set(lower, user);
      return newSession(user);
    },
    async login(name, pin) {
      gate(); stats.loginCalls++;
      const n = validName(name); validPin(pin);
      const lower = n.toLowerCase();
      const a = attempts.get(lower);
      const wait = lockedFor(a);
      if (wait) throw syncError("locked", "Too many attempts. Try again later.", { retryAfterSec: wait });
      if (a && a.lockedUntil && a.lockedUntil <= now()) attempts.delete(lower);
      const user = users.get(lower);
      // Hash even for unknown names so timing does not reveal whether a name exists.
      const h = await hashPin(pin, user ? user.salt : "00".repeat(16), iterations);
      if (user && h === user.hash) { attempts.delete(lower); return newSession(user); }
      const rec = attempts.get(lower) || { count: 0, lockedUntil: 0 };
      rec.count++;
      attempts.set(lower, rec);
      if (rec.count >= MAX_ATTEMPTS) {
        rec.lockedUntil = now() + LOCK_MS; rec.count = 0;
        throw syncError("locked", "Too many attempts. Try again later.", { retryAfterSec: Math.ceil(LOCK_MS / 1000) });
      }
      throw syncError("unauthorized", UNAUTHORIZED_MESSAGE);
    },
    async putDocs(token, list) {
      gate(); stats.putCalls++;
      const store = auth(token);
      if (!Array.isArray(list) || list.length > MAX_BATCH) throw syncError("invalid", `At most ${MAX_BATCH} docs per call`);
      const accepted = [], rejected = [];
      for (const d of list) {
        if (!d || typeof d.key !== "string" || !d.key || d.key.length > 512 || typeof d.updatedAt !== "number" || !Number.isFinite(d.updatedAt) || d.updatedAt < 0 || typeof d.deviceId !== "string" || !d.deviceId) {
          rejected.push({ key: d && d.key, reason: "invalid", current: null }); continue;
        }
        const value = d.deleted ? "" : d.value;
        if (typeof value !== "string") { rejected.push({ key: d.key, reason: "invalid", current: null }); continue; }
        if (enc.encode(value).length > MAX_VALUE_BYTES) { rejected.push({ key: d.key, reason: "too_large", current: null }); continue; }
        const cur = store.items.get(d.key);
        // Newer wins; equal non-zero updatedAt is broken by higher deviceId. updatedAt 0 (legacy) never beats a stored doc.
        const wins = !cur || d.updatedAt > cur.updatedAt || (d.updatedAt === cur.updatedAt && d.updatedAt > 0 && d.deviceId > cur.deviceId);
        if (!wins) { rejected.push({ key: d.key, reason: "stale", current: publicDoc(cur) }); continue; }
        store.items.set(d.key, { key: d.key, value, updatedAt: d.updatedAt, deviceId: d.deviceId, deleted: !!d.deleted, seq: ++store.seq });
        accepted.push({ key: d.key, serverUpdatedAt: d.updatedAt });
      }
      return { accepted, rejected };
    },
    async getDocs(token, cursor, limit = 200) {
      gate(); stats.getCalls++;
      const store = auth(token);
      let after = 0;
      if (cursor != null) {
        const m = /^s(\d+)$/.exec(cursor);
        if (!m) throw syncError("invalid", "Bad cursor");
        after = Number(m[1]);
      }
      const lim = Math.min(200, Math.max(1, Math.floor(Number(limit)) || 200));
      const all = [...store.items.values()].filter((d) => d.seq > after).sort((a, b) => a.seq - b.seq);
      const page = all.slice(0, lim);
      const last = page.length ? page[page.length - 1].seq : after;
      return { docs: page.map(publicDoc), cursor: "s" + last, hasMore: all.length > page.length };
    },
    async deleteAccountData(token) {
      gate();
      const store = auth(token);
      store.items.clear();
    },
  };
  const publicDoc = (d) => { const o = { key: d.key, value: d.value, updatedAt: d.updatedAt, deviceId: d.deviceId }; if (d.deleted) o.deleted = true; return o; };

  return {
    adapter,
    stats,
    setOffline(v) { offline = !!v; },
    /** Make the next n adapter calls fail with this code (or Error). */
    failNext(n = 1, code = "network") { failures = Array.from({ length: n }, () => code); },
    clearFailures() { failures = []; offline = false; },
    expireTokens() { for (const t of tokens.values()) t.expiresAt = 0; },
    docCount(name) { const u = users.get(String(name).toLowerCase()); const s = u && docs.get(u.id); return s ? s.items.size : 0; },
    /** For tests: stored password material (never the PIN). */
    _userRecord(name) { return users.get(String(name).toLowerCase()); },
  };
}

export function createMockAdapter(opts) {
  const server = createMockServer(opts);
  return { ...server.adapter, server };
}
