// Pure storage helpers for the Log and Meds tabs. No DOM.
export const LOG_KEY = "elevate-planner:log";
export const MEDS_KEY = "elevate-planner:meds";

export function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: ignore */
  }
}

// ---- Log: { "YYYY-MM-DD": { weight, water, steps, sets: { [exerciseIndex]: n } } } ----
export function getLog(key) {
  const day = readJSON(LOG_KEY)[key] || {};
  return { weight: day.weight ?? null, water: day.water || 0, steps: day.steps ?? null, sets: day.sets || {} };
}

export function updateLog(key, patch) {
  const all = readJSON(LOG_KEY);
  all[key] = { ...(all[key] || {}), ...patch };
  writeJSON(LOG_KEY, all);
  return getLog(key);
}

export function setWeight(key, kg) {
  const n = Number(kg);
  return updateLog(key, { weight: Number.isFinite(n) && n > 0 ? n : null });
}

export function addWater(key, delta) {
  const cur = getLog(key).water;
  return updateLog(key, { water: Math.max(0, cur + delta) });
}

export function setSteps(key, steps) {
  const n = Math.floor(Number(steps));
  return updateLog(key, { steps: Number.isFinite(n) && n >= 0 && steps !== "" ? n : null });
}

export function setSetsDone(key, exIdx, n) {
  const sets = { ...getLog(key).sets, [exIdx]: Math.max(0, n) };
  return updateLog(key, { sets });
}

// Last `limit` weight entries, oldest first: [{date, kg}]
export function weightHistory(limit = 30) {
  const all = readJSON(LOG_KEY);
  return Object.keys(all)
    .filter((k) => typeof all[k]?.weight === "number")
    .sort()
    .slice(-limit)
    .map((k) => ({ date: k, kg: all[k].weight }));
}

// ---- Meds taken: { "YYYY-MM-DD": [doseIds] } ----
export function getTaken(key) {
  const v = readJSON(MEDS_KEY)[key];
  return new Set(Array.isArray(v) ? v : []);
}

export function setTaken(key, id, taken) {
  const all = readJSON(MEDS_KEY);
  const s = new Set(Array.isArray(all[key]) ? all[key] : []);
  if (taken) s.add(id);
  else s.delete(id);
  all[key] = [...s];
  writeJSON(MEDS_KEY, all);
}
