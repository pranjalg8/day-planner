// Module-level sync singleton. Imported first by app.js so write tracking is in
// place before anything renders. With sync not configured (no adapter) nothing
// is installed and the app behaves exactly as before.
import { hasPlannerData } from "./accountdata.js";
// Namespace imports: tolerant of which of the three modules exports which function.
import * as engineMod from "./syncengine.js";
import * as storeMod from "./syncstore.js";
import * as configMod from "./syncconfig.js";

const SESSION_KEY = "day-planner-sync:session";
const mods = [engineMod, storeMod, configMod];
const pick = (name) => mods.find((m) => typeof m[name] === "function")?.[name] || null;

let engine = null;
try {
  const getAdapter = pick("getAdapter");
  const adapter = getAdapter ? getAdapter() : null;
  const create = pick("createSyncEngine");
  if (adapter && create) {
    pick("installWriteTracking")?.(localStorage);
    engine = create({ storage: localStorage, adapter });
  }
} catch (e) {
  console.warn("Cloud sync unavailable:", e && e.message);
  engine = null;
}

let rerender = () => {};

export const getEngine = () => engine;
export const isSyncConfigured = () => !!engine;
export function setRerender(fn) { if (typeof fn === "function") rerender = fn; }
export function requestRerender() { try { rerender(); } catch { /* ignore */ } }

function hasSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    return !!(s && s.token);
  } catch { return false; }
}

/** Start background syncing when a session exists. */
export function startEngineIfSignedIn() {
  if (engine && hasSession()) { try { engine.start(); } catch (e) { console.warn("sync start failed:", e && e.message); } }
}

function plannerKeys() {
  const keys = [];
  try { for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch { /* ignore */ }
  return keys;
}

/** What this device holds locally: { days, hasOtherData } (never throws). */
export function localCounts() {
  try {
    const c = engine && engine.countLocalDocs && engine.countLocalDocs();
    if (c) return { days: c.days, hasOtherData: !!(c.hasOtherData ?? c.hasOther) };
  } catch { /* fall through */ }
  const keys = plannerKeys().filter((k) => k && k.startsWith("elevate-planner:"));
  const days = keys.filter((k) => /^elevate-planner:\d{4}-\d{2}-\d{2}$/.test(k)).length;
  return { days, hasOtherData: keys.length > days };
}

/** True while a pre-link safety copy exists. Unknown API shape: assume yes if the engine can't say. */
export function hasPreLinkSnapshot() {
  if (!engine || typeof engine.restorePreLinkSnapshot !== "function") return false;
  try {
    if (typeof engine.hasPreLinkSnapshot === "function") return !!engine.hasPreLinkSnapshot();
    const st = engine.getState();
    if (st && "hasPreLinkSnapshot" in st) return !!st.hasPreLinkSnapshot;
    if (st && "preLinkSnapshot" in st) return !!st.preLinkSnapshot;
  } catch { /* ignore */ }
  return false;
}

let watching = false;
/**
 * After a successful sign-in/up: announce pulled data (so first-run setup is
 * marked done) and re-render once the first sync has finished.
 */
export function afterAuth() {
  const announce = () => {
    if (hasPlannerData(plannerKeys())) document.dispatchEvent(new CustomEvent("planner:data-restored", { detail: { source: "sync" } }));
  };
  announce();
  requestRerender();
  if (!engine || watching) return;
  watching = true;
  let off = null;
  const t0 = Date.now();
  const done = () => { watching = false; clearTimeout(timer); if (typeof off === "function") off(); };
  const timer = setTimeout(done, 60000);
  off = engine.subscribe((st) => {
    if (st && st.status === "idle" && st.lastSyncAt && st.lastSyncAt >= t0 - 1000) {
      announce();
      requestRerender();
      done();
    } else if (st && (st.status === "signed-out" || st.status === "error")) done();
  });
  if (typeof off !== "function") off = null;
}
