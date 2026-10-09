// Pure helpers for quick actions (done/snooze from notifications, deep links).

export const SNOOZE_MIN = 15;

export function markDone(state, id) {
  const done = new Set(state.done || []);
  done.add(id);
  return { ...state, done: [...done] };
}

export function unmarkDone(state, id) {
  return { ...state, done: (state.done || []).filter((d) => d !== id) };
}

/** Parse ?tab=log&done=id&snooze=id&date=YYYY-MM-DD into a plain object. */
export function parseDeepLink(search) {
  const p = new URLSearchParams(search || "");
  const out = {};
  const tab = p.get("tab");
  if (tab && /^[a-z]{2,20}$/.test(tab)) out.tab = tab;
  const date = p.get("date");
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) out.date = date;
  const done = p.get("done");
  if (done && /^[\w-]{1,60}$/.test(done)) out.done = done;
  const snooze = p.get("snooze");
  if (snooze && /^[\w-]{1,60}$/.test(snooze)) out.snooze = snooze;
  return out;
}

/** Local Date from "YYYY-MM-DD" (noon-free; local midnight). */
export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  // Reject impossible dates (Feb 30 would otherwise roll over to Mar 2).
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
}
