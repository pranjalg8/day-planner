// Pure grouping of a computed day (engine.computeDay output) into display
// blocks. No DOM, no storage.

const BLOCK_DEFS = [
  { id: "morning", name: "Morning", icon: "🌅", from: 0, to: 480 },
  { id: "breakfast", name: "Breakfast", icon: "🍳", from: 480, to: 660 },
  { id: "lunch", name: "Lunch", icon: "🥗", from: 660, to: 900 },
  { id: "afternoon", name: "Afternoon", icon: "☀️", from: 900, to: 1110 },
  { id: "dinner", name: "Dinner", icon: "🍲", from: 1110, to: 1260 },
  { id: "night", name: "Night", icon: "🌙", from: 1260, to: 1441 },
];
const WORKOUT_BLOCK = { id: "workout", name: "Workout", icon: "🏋️" };

/** Which block id an item belongs to. The 07:00 workout items (ids
 * workout-warmup, workout-N) form 'workout'; everything else is by time. */
export function blockIdFor(item) {
  if (item.id === "workout-warmup" || /^workout-\d+$/.test(item.id)) return WORKOUT_BLOCK.id;
  const m = item.minutes;
  return (BLOCK_DEFS.find((b) => m >= b.from && m < b.to) || BLOCK_DEFS[BLOCK_DEFS.length - 1]).id;
}

/**
 * @param {Array} items - computeDay() output (sorted by time).
 * @returns {Array<{id,name,icon,items,count,doneCount,startMinutes}>}
 *   non-empty blocks, ordered by their first item.
 */
export function groupItems(items) {
  const meta = Object.fromEntries([...BLOCK_DEFS, WORKOUT_BLOCK].map((b) => [b.id, b]));
  const map = new Map();
  for (const item of items) {
    const id = blockIdFor(item);
    if (!map.has(id)) map.set(id, { id, name: meta[id].name, icon: meta[id].icon, items: [] });
    map.get(id).items.push(item);
  }
  return [...map.values()]
    .map((b) => ({
      ...b,
      count: b.items.length,
      doneCount: b.items.filter((i) => i.done).length,
      startMinutes: Math.min(...b.items.map((i) => i.minutes)),
    }))
    .sort((a, b) => a.startMinutes - b.startMinutes);
}
