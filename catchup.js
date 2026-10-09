// Pure helpers for the Today checklist: splits a day's items into
// "catch up" (due earlier, still unchecked), "coming up" and "done".
// No DOM, no storage.

/**
 * @param {Array} items - computeDay() output.
 * @param {{isToday:boolean,isPast:boolean,nowMin:number}} ctx
 */
export function splitItems(items, { isToday, isPast, nowMin }) {
  const done = [];
  const catchUp = [];
  const upcoming = [];
  for (const item of items) {
    if (item.done) done.push(item);
    else if (isPast || (isToday && item.minutes < nowMin)) catchUp.push(item);
    else upcoming.push(item);
  }
  return { catchUp, upcoming, done };
}

// Medicines are never bulk-ticked: each dose should be confirmed on its own so
// the record stays honest. Everything else (meals, walks, water, workout...) can be.
export function bulkMarkable(items) {
  return items.filter((i) => i.category !== "medicine");
}

// The next thing still ahead of you (today only).
export function nextUpcoming(upcoming, isToday) {
  return isToday ? upcoming[0] || null : null;
}
