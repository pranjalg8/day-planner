// Sync bookkeeping + write tracking. Pure over a Storage-like object; no DOM.
export const DOC_PREFIX = "elevate-planner:";
export const SYNC_PREFIX = "day-planner-sync:";
export const DEVICE_KEY = SYNC_PREFIX + "deviceId";
export const SESSION_KEY = SYNC_PREFIX + "session";
export const META_KEY = SYNC_PREFIX + "meta";
export const SNAPSHOT_KEY = SYNC_PREFIX + "preLinkSnapshot";
const DAY_RE = /^elevate-planner:\d{4}-\d{2}-\d{2}$/;

export const isDocKey = (k) => typeof k === "string" && k.startsWith(DOC_PREFIX);

export function syncError(code, message, extra = {}) {
  const e = new Error(message || code);
  e.code = code;
  Object.assign(e, extra);
  return e;
}

const parse = (raw) => { try { const v = JSON.parse(raw); return v && typeof v === "object" ? v : null; } catch { return null; } };

export function readMeta(storage) {
  const m = parse(storage.getItem(META_KEY)) || {};
  return {
    updatedAt: m.updatedAt && typeof m.updatedAt === "object" ? m.updatedAt : {},
    dirty: m.dirty && typeof m.dirty === "object" ? m.dirty : {},
    cursor: typeof m.cursor === "string" ? m.cursor : null,
    lastSyncAt: typeof m.lastSyncAt === "number" ? m.lastSyncAt : null,
    linkedName: typeof m.linkedName === "string" ? m.linkedName : null,
  };
}
export function writeMeta(storage, meta) {
  try { storage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* quota: best effort */ }
}

export function getDeviceId(storage) {
  let id = storage.getItem(DEVICE_KEY);
  if (!id) {
    id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : "d" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    storage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function readSession(storage) {
  const s = parse(storage.getItem(SESSION_KEY));
  return s && typeof s.token === "string" ? s : null;
}
export const writeSession = (storage, s) => storage.setItem(SESSION_KEY, JSON.stringify({ token: s.token, expiresAt: s.expiresAt, name: s.name }));
export const clearSession = (storage) => storage.removeItem(SESSION_KEY);

export function docKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (isDocKey(k)) keys.push(k); }
  return keys;
}

/** { days, hasOther }: number of day docs on this device and whether any non-day data exists. */
export function countLocalDocs(storage) {
  const keys = docKeys(storage);
  const days = keys.filter((k) => DAY_RE.test(k)).length;
  // The app writes its streak history on first render, so it doesn't count as "data worth merging".
  const other = keys.filter((k) => !DAY_RE.test(k) && k !== "elevate-planner:history").length;
  return { days, hasOther: other > 0 };
}

/** Keys with no stamp (or stamp 0) are LEGACY: never synced, updatedAt treated as 0. Marks them dirty. */
export function adoptLegacyDocs(storage) {
  const meta = readMeta(storage);
  let n = 0;
  for (const k of docKeys(storage)) {
    if (meta.updatedAt[k] === undefined) { meta.updatedAt[k] = 0; meta.dirty[k] = true; n++; }
  }
  if (n) writeMeta(storage, meta);
  return n;
}
export const isLegacy = (meta, key) => !meta.updatedAt[key];

// ---- write tracking ----
const trackers = new WeakMap();
let protoOrig = null;

/**
 * Wraps storage.setItem/removeItem so "elevate-planner:" writes set updatedAt and mark the key dirty.
 * Idempotent per storage. Returns a tracker { listeners, withoutTracking(fn), setClock(now) }.
 */
export function installWriteTracking(storage, opts = {}) {
  let t = trackers.get(storage);
  if (t) { if (opts.now) t.now = opts.now; return t; }
  const proto = typeof Storage !== "undefined" && storage instanceof Storage ? Storage.prototype : null;
  if (proto && !protoOrig) protoOrig = { setItem: proto.setItem, removeItem: proto.removeItem, getItem: proto.getItem };
  const src = proto ? protoOrig : storage;
  const rawSet = src.setItem.bind(storage), rawRemove = src.removeItem.bind(storage), rawGet = src.getItem.bind(storage);
  t = { now: opts.now || Date.now, applying: 0, listeners: new Set(), storage };
  t.setClock = (now) => { t.now = now; };
  t.withoutTracking = (fn) => { t.applying++; try { return fn(); } finally { t.applying--; } };
  const mark = (k) => {
    try {
      const meta = readMeta(storage);
      meta.updatedAt[k] = Math.max(t.now(), (meta.updatedAt[k] || 0) + 1);
      meta.dirty[k] = true;
      writeMeta(storage, meta);
    } catch { /* never break the app's own write */ }
    for (const fn of [...t.listeners]) { try { fn(k); } catch { /* ignore */ } }
  };
  const set = (key, value) => {
    const k = String(key), v = String(value);
    const track = isDocKey(k) && !t.applying;
    const changed = track ? rawGet(k) !== v : false;
    rawSet(k, v);
    if (changed) mark(k);
  };
  const remove = (key) => {
    const k = String(key);
    const track = isDocKey(k) && !t.applying;
    const existed = track ? rawGet(k) !== null : false;
    rawRemove(k);
    if (existed) mark(k);
  };
  t.set = set; t.remove = remove;
  trackers.set(storage, t);
  if (proto) {
    if (!proto.setItem.__syncTracked) {
      proto.setItem = Object.assign(function (k, v) { const tr = trackers.get(this); return tr ? tr.set(k, v) : protoOrig.setItem.call(this, k, v); }, { __syncTracked: true });
      proto.removeItem = Object.assign(function (k) { const tr = trackers.get(this); return tr ? tr.remove(k) : protoOrig.removeItem.call(this, k); }, { __syncTracked: true });
    }
  } else {
    storage.setItem = set;
    storage.removeItem = remove;
  }
  return t;
}
