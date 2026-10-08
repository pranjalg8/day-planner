// Pure helpers for "Missed" medicine handling. Hints are data-driven:
// a medicine in data.js may carry an optional `missedHint`; otherwise a
// cautious generic hint is used. Nothing here is medical advice beyond
// what the plan's own notes already say.
import { MEDICINES } from "./data.js";

export const GENERIC_MISSED_HINT =
  "Take it when you remember unless it is close to the next dose. Check with your doctor if unsure.";

export function missedHint(itemId, meds = MEDICINES) {
  const med = meds.find((m) => m.id === itemId);
  return (med && med.missedHint) || GENERIC_MISSED_HINT;
}

/**
 * Unchecked medicine items whose time has passed.
 * @param {Array} items computeDay() output
 * @param {{isToday:boolean,isPast:boolean,nowMin:number}} ctx
 */
export function findMissed(items, { isToday, isPast, nowMin }) {
  return items.filter(
    (i) => i.category === "medicine" && !i.done && (isPast || (isToday && i.minutes < nowMin))
  );
}
