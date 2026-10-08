// Pure builders for the weekly coach report. No DOM, no storage: callers pass
// plain data so everything is unit-testable.

export const REPORT_FIELDS = [
  { id: "adherence", label: "Plan adherence", default: true },
  { id: "water", label: "Water", default: true },
  { id: "steps", label: "Steps", default: true },
  { id: "workouts", label: "Workouts", default: true },
  { id: "meds", label: "Meds taken", default: true },
  { id: "weight", label: "Weight", default: false },
];

export function defaultInclude() {
  return Object.fromEntries(REPORT_FIELDS.map((f) => [f.id, f.default]));
}

function pad(n) { return String(n).padStart(2, "0"); }
export function keyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** Monday on/before the given date (local), as a Date at midnight. */
export function weekStartOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export function weekKeys(start) {
  return Array.from({ length: 7 }, (_, i) => keyOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
}

/**
 * @param {object} p
 * @param {Date} p.start - Monday of the week
 * @param {object} p.log - { key: { weight, water, steps, sets } } (raw log map)
 * @param {object} p.taken - { key: [doseIds] }
 * @param {object} p.history - { key: { done, total } }
 * @param {object} p.expectedMeds - { key: number } doses scheduled that day
 * @param {number} p.totalSets - sets in a full workout circuit
 * @param {object} p.targets - { water (litres), steps }
 */
export function buildWeekData({ start, log = {}, taken = {}, history = {}, expectedMeds = {}, totalSets = 0, targets = {} }) {
  const keys = weekKeys(start);
  const days = keys.map((key) => {
    const l = log[key] || {};
    const h = history[key];
    const sets = Object.values(l.sets || {}).reduce((a, n) => a + (Number(n) || 0), 0);
    return {
      key,
      done: h ? h.done : null,
      total: h ? h.total : null,
      weight: typeof l.weight === "number" ? l.weight : null,
      water: Number(l.water) || 0,
      steps: typeof l.steps === "number" ? l.steps : null,
      sets,
      medsTaken: Array.isArray(taken[key]) ? taken[key].length : 0,
      medsExpected: Number(expectedMeds[key]) || 0,
    };
  });
  const tracked = days.filter((d) => d.total > 0);
  const sum = (a, f) => a.reduce((x, d) => x + f(d), 0);
  const stepDays = days.filter((d) => d.steps !== null);
  const weights = days.filter((d) => d.weight !== null);
  return {
    start: keys[0],
    end: keys[6],
    days,
    adherence: {
      daysTracked: tracked.length,
      done: sum(tracked, (d) => d.done),
      total: sum(tracked, (d) => d.total),
      percent: tracked.length ? Math.round((100 * sum(tracked, (d) => d.done)) / sum(tracked, (d) => d.total)) : null,
    },
    water: { totalL: sum(days, (d) => d.water), daysLogged: days.filter((d) => d.water > 0).length, targetL: targets.water ?? null },
    steps: { total: sum(stepDays, (d) => d.steps), daysLogged: stepDays.length, avg: stepDays.length ? Math.round(sum(stepDays, (d) => d.steps) / stepDays.length) : null, target: targets.steps ?? null },
    workouts: { sets: sum(days, (d) => d.sets), daysWorked: days.filter((d) => d.sets > 0).length, circuitSets: totalSets },
    meds: { taken: sum(days, (d) => d.medsTaken), expected: sum(days, (d) => d.medsExpected) },
    weight: { first: weights[0]?.weight ?? null, last: weights.at(-1)?.weight ?? null, change: weights.length > 1 ? Math.round((weights.at(-1).weight - weights[0].weight) * 10) / 10 : null, entries: weights.length },
  };
}

const num = (n) => (Math.round(n * 10) / 10).toString();

/** Markdown report; only sections whose include flag is true appear. */
export function buildReport(data, include = defaultInclude()) {
  const L = [`# Weekly report: ${data.start} to ${data.end}`, ""];
  if (include.adherence) {
    const a = data.adherence;
    L.push("## Plan adherence");
    L.push(a.percent === null ? "- No tracked days this week." : `- ${a.percent}% of plan items completed (${a.done}/${a.total}) across ${a.daysTracked} tracked day(s)`);
    L.push("");
  }
  if (include.water) {
    const w = data.water;
    L.push("## Water");
    L.push(w.daysLogged ? `- ${num(w.totalL)} L total over ${w.daysLogged} day(s), avg ${num(w.totalL / w.daysLogged)} L/day logged${w.targetL ? ` (target ${w.targetL} L)` : ""}` : "- Nothing logged.");
    L.push("");
  }
  if (include.steps) {
    const s = data.steps;
    L.push("## Steps");
    L.push(s.daysLogged ? `- Average ${s.avg} steps/day over ${s.daysLogged} day(s)${s.target ? ` (target ${s.target})` : ""}; total ${s.total}` : "- Nothing logged.");
    L.push("");
  }
  if (include.workouts) {
    const w = data.workouts;
    L.push("## Workouts");
    L.push(w.daysWorked ? `- ${w.daysWorked} workout day(s), ${w.sets} sets logged${w.circuitSets ? ` (full circuit = ${w.circuitSets} sets)` : ""}` : "- No workouts logged.");
    L.push("");
  }
  if (include.meds) {
    const m = data.meds;
    L.push("## Meds taken");
    L.push(m.expected ? `- ${m.taken} of ${m.expected} scheduled doses marked taken` : `- ${m.taken} dose(s) marked taken`);
    L.push("");
  }
  if (include.weight) {
    const w = data.weight;
    L.push("## Weight");
    L.push(w.entries ? `- ${w.entries} entr${w.entries === 1 ? "y" : "ies"}; latest ${num(w.last)} kg${w.change !== null ? `, change ${w.change > 0 ? "+" : ""}${w.change} kg over the week` : ""}` : "- No weight logged.");
    L.push("");
  }
  L.push("_Generated by Day Planner. Not medical advice._");
  return L.join("\n") + "\n";
}

export function reportFilename(data) {
  return `weekly-report-${data.start}.md`;
}
