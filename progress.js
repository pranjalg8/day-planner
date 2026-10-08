// Pure helpers for per-day completion history and streaks, plus thin
// localStorage wrappers. History shape: { "YYYY-MM-DD": { done, total } }.

export const HISTORY_KEY = "elevate-planner:history";
export const STREAK_THRESHOLD = 0.8;

export function loadHistory(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(HISTORY_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveHistory(history, storage = globalThis.localStorage) {
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* storage unavailable: history is best-effort */
  }
}

/** Returns a new history with the day recorded. */
export function recordDay(history, key, done, total) {
  return { ...history, [key]: { done, total } };
}

export function completionRatio(entry) {
  return entry && entry.total > 0 ? entry.done / entry.total : 0;
}

function shiftKey(key, delta) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * Consecutive days (ending today, or yesterday if today is not yet at the
 * threshold) with completion >= threshold.
 */
export function computeStreak(history, todayKey, threshold = STREAK_THRESHOLD) {
  const ok = (k) => completionRatio(history[k]) >= threshold;
  let key = ok(todayKey) ? todayKey : shiftKey(todayKey, -1);
  let streak = 0;
  while (ok(key)) {
    streak++;
    key = shiftKey(key, -1);
  }
  return streak;
}
