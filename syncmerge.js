// Pure merge of two raw localStorage values for the same key. Used when a device that
// still holds legacy (never-synced) data first links to an account that already has a
// document for that key. No DOM, no storage.
const PREFIX = "elevate-planner:";
const DAY_RE = /^elevate-planner:\d{4}-\d{2}-\d{2}$/;

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const parse = (raw) => { try { return JSON.parse(raw); } catch { return undefined; } };
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const maxNum = (a, b) => {
  const x = num(a), y = num(b);
  return x == null ? y : y == null ? x : Math.max(x, y);
};

export function mergeDayState(server, local) {
  const done = [...new Set([...(Array.isArray(server.done) ? server.done : []), ...(Array.isArray(local.done) ? local.done : [])])];
  return { ...local, ...server, done, overrides: { ...(isObj(local.overrides) ? local.overrides : {}), ...(isObj(server.overrides) ? server.overrides : {}) } };
}

function mergeSets(s, l) {
  if (!isObj(s) && !isObj(l)) return s ?? l;
  const out = { ...(isObj(l) ? l : {}), ...(isObj(s) ? s : {}) };
  for (const k of Object.keys(out)) out[k] = maxNum(isObj(s) ? s[k] : null, isObj(l) ? l[k] : null) ?? out[k];
  return out;
}

export function mergeLog(server, local) {
  const out = { ...local, ...server };
  for (const date of Object.keys(out)) {
    const s = isObj(server[date]) ? server[date] : null;
    const l = isObj(local[date]) ? local[date] : null;
    if (!s || !l) { out[date] = s || l || out[date]; continue; }
    out[date] = {
      ...l, ...s,
      weight: s.weight ?? l.weight ?? null,
      water: maxNum(s.water, l.water) ?? 0,
      steps: maxNum(s.steps, l.steps),
      sets: mergeSets(s.sets, l.sets),
    };
    if (out[date].steps == null) out[date].steps = null;
  }
  return out;
}

export function mergeMeds(server, local) {
  const out = { ...local, ...server };
  for (const date of Object.keys(out)) {
    const s = Array.isArray(server[date]) ? server[date] : null;
    const l = Array.isArray(local[date]) ? local[date] : null;
    if (s && l) out[date] = [...new Set([...s, ...l])];
    else out[date] = s || l || out[date];
  }
  return out;
}

export function mergeHistory(server, local) {
  const out = { ...local, ...server };
  for (const date of Object.keys(out)) {
    const s = server[date], l = local[date];
    if (isObj(s) && isObj(l)) out[date] = (num(l.done) ?? -1) > (num(s.done) ?? -1) ? l : s;
  }
  return out;
}

/** Merge raw strings; returns the raw merged string. Unknown/corrupt data: the server's value wins. */
export function mergeValues(key, serverRaw, localRaw) {
  if (typeof serverRaw !== "string") return localRaw;
  if (typeof localRaw !== "string" || localRaw === serverRaw) return serverRaw;
  const s = parse(serverRaw), l = parse(localRaw);
  if (!isObj(s) || !isObj(l)) return serverRaw;
  let merged;
  if (DAY_RE.test(key)) merged = mergeDayState(s, l);
  else if (key === PREFIX + "log") merged = mergeLog(s, l);
  else if (key === PREFIX + "meds") merged = mergeMeds(s, l);
  else if (key === PREFIX + "history") merged = mergeHistory(s, l);
  else return serverRaw;
  return JSON.stringify(merged);
}
