// Local-first sync engine. localStorage stays the working copy; documents are pushed/pulled
// through an injected adapter. No DOM dependency (browser events are optional and injectable).
import { SYNC_BASE_URL } from "./syncconfig.js";
import { createHttpAdapter } from "./syncadapter-http.js";
import { mergeValues } from "./syncmerge.js";
import {
  SNAPSHOT_KEY, syncError, isDocKey, readMeta, writeMeta, getDeviceId, readSession, writeSession,
  clearSession, docKeys, adoptLegacyDocs, installWriteTracking, countLocalDocs as countDocs,
} from "./syncstore.js";

export { installWriteTracking } from "./syncstore.js";

export const BATCH_SIZE = 25;
export const PAGE_SIZE = 200;
export const DEBOUNCE_MS = 20000;
export const BACKOFF_BASE_MS = 5000;
export const BACKOFF_CAP_MS = 300000;

export function getAdapter() {
  return globalThis.__SYNC_ADAPTER__ || (SYNC_BASE_URL ? createHttpAdapter() : null);
}

export function countLocalDocs(storage = globalThis.localStorage) { return countDocs(storage); }

const cmp = (t1, d1, t2, d2) => (t1 !== t2 ? (t1 > t2 ? 1 : -1) : d1 === d2 ? 0 : d1 > d2 ? 1 : -1);

export function createSyncEngine({
  storage = globalThis.localStorage, adapter, now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h),
  debounceMs = DEBOUNCE_MS, backoffBaseMs = BACKOFF_BASE_MS, target = globalThis, doc = globalThis.document,
} = {}) {
  const tracker = installWriteTracking(storage, { now });
  tracker.setClock(now);
  const getAd = () => adapter || getAdapter();
  const subs = new Set(), appliedSubs = new Set();
  let st = { status: "idle", error: null };
  let timer = null, started = false, inflight = null, rerun = null;
  let fails = 0, blockedUntil = 0, needPull = true, gen = 0, offListeners = [];

  const validSession = () => {
    const s = readSession(storage);
    if (s && typeof s.expiresAt === "number" && s.expiresAt <= now()) { clearSession(storage); return null; }
    return s;
  };

  function getState() {
    const meta = readMeta(storage);
    const s = validSession();
    const status = !getAd() ? "off" : !s ? "signed-out" : st.status;
    return {
      status, name: s ? s.name : null, lastSyncAt: meta.lastSyncAt, pending: Object.keys(meta.dirty).length,
      error: status === "signed-out" || status === "off" ? st.error : st.error, linkedName: meta.linkedName,
    };
  }
  function emit() { const s = getState(); for (const f of [...subs]) { try { f(s); } catch { /* ignore */ } } }
  function setSt(status, error = null) { st = { status, error }; emit(); }
  function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
  function onApplied(fn) { appliedSubs.add(fn); return () => appliedSubs.delete(fn); }

  function arm(ms) {
    if (timer != null) clearTimer(timer);
    timer = setTimer(() => { timer = null; syncNow({ pull: needPull }); }, ms);
  }
  function disarm() { if (timer != null) { clearTimer(timer); timer = null; } }
  function armDebounce() { arm(Math.max(debounceMs, blockedUntil - now())); }

  function signedOut(message) {
    clearSession(storage); gen++; disarm(); fails = 0; blockedUntil = 0;
    st = { status: "signed-out", error: message || null }; emit();
  }

  // Merge one remote doc into local storage (synchronous; caller persists meta).
  function applyRemote(meta, d, deviceId) {
    const key = d && d.key;
    if (!isDocKey(key) || typeof d.updatedAt !== "number") return false;
    if (!d.deleted && typeof d.value !== "string") return false;
    const raw = storage.getItem(key);
    const stamp = meta.updatedAt[key];
    const legacy = raw !== null && !stamp;
    const write = (value) => tracker.withoutTracking(() => (value === null ? storage.removeItem(key) : storage.setItem(key, value)));
    let changed = false;
    if (legacy) {
      if (d.deleted) { meta.updatedAt[key] = Math.max(now(), d.updatedAt + 1); meta.dirty[key] = true; return false; }
      const merged = mergeValues(key, d.value, raw);
      if (merged === d.value) {
        if (raw !== d.value) { write(d.value); changed = true; }
        meta.updatedAt[key] = Math.max(1, d.updatedAt); delete meta.dirty[key];
      } else {
        write(merged); changed = true;
        meta.updatedAt[key] = Math.max(now(), d.updatedAt + 1); meta.dirty[key] = true;
      }
      return changed;
    }
    if (meta.dirty[key] && cmp(stamp || 0, deviceId, d.updatedAt, d.deviceId || "") > 0) return false;
    if (d.deleted) { if (raw !== null) { write(null); changed = true; } }
    else if (raw !== d.value) { write(d.value); changed = true; }
    meta.updatedAt[key] = d.updatedAt; delete meta.dirty[key];
    return changed;
  }

  async function pullAll(token, myGen, ad, deviceId) {
    for (;;) {
      const cursor = readMeta(storage).cursor;
      const page = await ad.getDocs(token, cursor, PAGE_SIZE);
      if (myGen !== gen) return false;
      const meta = readMeta(storage);
      const keys = [];
      for (const d of page.docs || []) if (applyRemote(meta, d, deviceId)) keys.push(d.key);
      if (typeof page.cursor === "string") meta.cursor = page.cursor;
      writeMeta(storage, meta);
      if (keys.length) for (const f of [...appliedSubs]) { try { f(keys); } catch { /* ignore */ } }
      if (!page.hasMore) return true;
    }
  }

  async function pushAll(token, myGen, ad, deviceId) {
    let warning = null;
    for (let round = 0; round < 3; round++) {
      const meta = readMeta(storage);
      const keys = Object.keys(meta.dirty).filter(isDocKey);
      if (!keys.length) break;
      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const docs = keys.slice(i, i + BATCH_SIZE).map((key) => {
          const value = storage.getItem(key);
          const updatedAt = meta.updatedAt[key] || 0;
          return value === null ? { key, value: "", updatedAt, deviceId, deleted: true } : { key, value, updatedAt, deviceId };
        });
        const res = await ad.putDocs(token, docs);
        if (myGen !== gen) return null;
        const m = readMeta(storage);
        const sent = new Map(docs.map((d) => [d.key, d.updatedAt]));
        const applied = [];
        for (const a of res.accepted || []) {
          if (!sent.has(a.key)) continue;
          if ((m.updatedAt[a.key] || 0) === sent.get(a.key)) {
            delete m.dirty[a.key];
            if (!m.updatedAt[a.key] && storage.getItem(a.key) !== null) m.updatedAt[a.key] = 1; // no longer legacy
          }
        }
        for (const r of res.rejected || []) {
          if (!sent.has(r.key)) continue;
          if (r.current) { if (applyRemote(m, r.current, deviceId)) applied.push(r.key); }
          else if ((m.updatedAt[r.key] || 0) === sent.get(r.key)) { delete m.dirty[r.key]; warning = `Some data could not be synced (${r.reason || "rejected"}).`; }
        }
        writeMeta(storage, m);
        if (applied.length) for (const f of [...appliedSubs]) { try { f(applied); } catch { /* ignore */ } }
      }
    }
    return { warning };
  }

  async function cycle({ pull, push }) {
    const s = validSession();
    const ad = getAd();
    if (!ad || !s) { emit(); return; }
    const myGen = gen;
    setSt("syncing");
    try {
      const deviceId = getDeviceId(storage);
      adoptLegacyDocs(storage);
      if (pull || needPull) { if (!(await pullAll(s.token, myGen, ad, deviceId))) return; }
      let warning = null;
      if (push) { const r = await pushAll(s.token, myGen, ad, deviceId); if (!r) return; warning = r.warning; }
      if (myGen !== gen) return;
      needPull = false; fails = 0; blockedUntil = 0;
      const meta = readMeta(storage); meta.lastSyncAt = now(); writeMeta(storage, meta);
      setSt("idle", warning);
    } catch (e) {
      if (myGen !== gen) return;
      if (e && e.code === "unauthorized") { signedOut("Your session expired. Please sign in again."); return; }
      fails++; needPull = true;
      const delay = Math.min(BACKOFF_CAP_MS, backoffBaseMs * 2 ** (fails - 1));
      blockedUntil = now() + delay;
      setSt(e && e.code === "network" ? "offline" : "error", (e && e.message) || "Sync failed");
      arm(delay);
    }
  }

  function syncNow(opts = {}) {
    const o = { pull: opts.pull !== false, push: opts.push !== false };
    if (inflight) { rerun = rerun ? { pull: rerun.pull || o.pull, push: rerun.push || o.push } : o; return inflight; }
    disarm();
    inflight = (async () => {
      let next = o;
      while (next) { rerun = null; await cycle(next); next = rerun; }
    })().finally(() => { inflight = null; });
    return inflight;
  }

  function snapshotLocal() {
    const keys = docKeys(storage);
    if (!keys.length) return;
    const data = {};
    for (const k of keys) data[k] = storage.getItem(k);
    try { storage.setItem(SNAPSHOT_KEY, JSON.stringify(data)); } catch { /* quota */ }
  }

  async function link(fn, name, pin, opts = {}) {
    const clean = typeof name === "string" ? name.trim() : "";
    if (clean.length < 2 || clean.length > 32) throw syncError("invalid", "Name must be 2 to 32 characters.");
    if (typeof pin !== "string" || !/^\d{4,8}$/.test(pin)) throw syncError("invalid", "PIN must be 4 to 8 digits.");
    const ad = getAd();
    if (!ad) throw syncError("network", "Cloud sync isn't set up yet.");
    const lower = clean.toLowerCase();
    const before = readMeta(storage);
    if (before.linkedName && before.linkedName !== lower && !opts.replaceLocal) {
      throw syncError("different_account", "This device is linked to another account.", { linkedName: before.linkedName });
    }
    const res = await ad[fn](clean, pin);
    gen++; disarm();
    const meta = readMeta(storage);
    if (opts.replaceLocal) {
      snapshotLocal();
      tracker.withoutTracking(() => { for (const k of docKeys(storage)) storage.removeItem(k); });
      meta.updatedAt = {}; meta.dirty = {}; meta.cursor = null; meta.lastSyncAt = null;
    } else if (!meta.linkedName) snapshotLocal();
    meta.linkedName = lower;
    writeMeta(storage, meta);
    writeSession(storage, { token: res.token, expiresAt: res.expiresAt, name: res.name || clean });
    fails = 0; blockedUntil = 0; needPull = true;
    st = { status: "idle", error: null };
    adoptLegacyDocs(storage);
    emit();
    await syncNow();
    return { name: res.name || clean };
  }

  const signup = (name, pin, opts) => link("signup", name, pin, opts);
  const login = (name, pin, opts) => link("login", name, pin, opts);

  function logout() { clearSession(storage); gen++; disarm(); st = { status: "signed-out", error: null }; emit(); }

  async function deleteCloudData() {
    const s = validSession();
    if (!s) throw syncError("unauthorized", "Not signed in.");
    try { await getAd().deleteAccountData(s.token); }
    catch (e) { if (e && e.code === "unauthorized") signedOut("Your session expired. Please sign in again."); throw e; }
    const meta = readMeta(storage);
    meta.cursor = null; meta.dirty = {}; meta.lastSyncAt = null;
    writeMeta(storage, meta);
    emit();
  }

  function hasPreLinkSnapshot() {
    try { return !!storage.getItem(SNAPSHOT_KEY); } catch { return false; }
  }

  function restorePreLinkSnapshot() {
    let data;
    try { data = JSON.parse(storage.getItem(SNAPSHOT_KEY)); } catch { data = null; }
    if (!data || typeof data !== "object") return false;
    // Undo the link: put the old data back as unsynced (legacy) data, unlink the device and sign out.
    tracker.withoutTracking(() => {
      for (const k of docKeys(storage)) storage.removeItem(k);
      for (const [k, v] of Object.entries(data)) if (isDocKey(k) && typeof v === "string") storage.setItem(k, v);
    });
    writeMeta(storage, { updatedAt: {}, dirty: {}, cursor: null, lastSyncAt: null, linkedName: null });
    clearSession(storage); gen++; disarm(); st = { status: "signed-out", error: null };
    storage.removeItem(SNAPSHOT_KEY);
    emit();
    return true;
  }

  const onWrite = () => { emit(); if (validSession() && getAd()) armDebounce(); };
  function listen(t, ev, fn) { if (t && t.addEventListener) { t.addEventListener(ev, fn); offListeners.push(() => t.removeEventListener(ev, fn)); } }

  function start() {
    if (started) return inflight || Promise.resolve();
    started = true;
    tracker.listeners.add(onWrite);
    listen(target, "online", () => { fails = 0; blockedUntil = 0; syncNow(); });
    listen(doc, "visibilitychange", () => {
      if (!validSession()) return;
      if (doc.visibilityState === "hidden") syncNow({ pull: false });
      else syncNow();
    });
    emit();
    return validSession() && getAd() ? syncNow() : Promise.resolve();
  }
  function stop() {
    started = false; tracker.listeners.delete(onWrite); disarm();
    for (const off of offListeners) off();
    offListeners = [];
  }

  return {
    signup, login, logout, syncNow, start, stop, getState, subscribe, deleteCloudData,
    onApplied, restorePreLinkSnapshot, hasPreLinkSnapshot, countLocalDocs: () => countDocs(storage),
  };
}
