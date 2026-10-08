import test from "node:test";
import assert from "node:assert/strict";
import { computeDay } from "../engine.js";
import { DEFAULT_TIMES, WORKOUT, MENUS } from "../data.js";
import * as ps from "../planstore.js";
import { parseMeal, buildGrocery, groceryText, weekOf, formatQty } from "../grocery.js";

const d = (s) => new Date(s + "T12:00:00");
const byId = (items, id) => items.find((i) => i.id === id);
const ids = (items) => items.map((i) => i.id);
const NONE = {};
// 2026-10-05 is a Monday; 2026-10-06 Tuesday; 2026-10-07 Wednesday.

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
}

test("computeDay with no plan equals pure program defaults", () => {
  for (const day of ["2026-10-05", "2026-10-06", "2026-10-10"]) {
    const a = computeDay(d(day), {}, new Set(), NONE);
    const b = computeDay(d(day));
    assert.deepEqual(a, b);
  }
});

test("normalizePlan sanitises garbage", () => {
  assert.deepEqual(ps.normalizePlan(null), ps.emptyPlan());
  assert.deepEqual(ps.normalizePlan("x"), ps.emptyPlan());
  const p = ps.normalizePlan({
    meals: { "2026-10-05": { breakfast: "  Eggs ", bogus: "x", lunch: "" }, nodate: { lunch: "y" } },
    off: [{ from: "2026-10-09", to: "2026-10-07", label: "  " }, { from: "bad" }, null],
    workoutDays: [1, 1, 9, "x", 3],
    times: { wake: "05:00", bedtime: "25:00", nope: "01:00" },
  });
  assert.deepEqual(p.meals, { "2026-10-05": { breakfast: "Eggs" } });
  assert.deepEqual(p.off, [{ from: "2026-10-07", to: "2026-10-09", label: "Off day" }]);
  assert.deepEqual(p.workoutDays, [1, 3]);
  assert.deepEqual(p.times, { wake: "05:00" });
});

test("meal swap applies only to that date and slot, and is flagged", () => {
  const plan = ps.setMealOverride({}, "2026-10-05", "lunch", "Restaurant thali");
  const mon = computeDay(d("2026-10-05"), {}, new Set(), plan);
  assert.equal(byId(mon, "lunch").notes, "Restaurant thali");
  assert.equal(byId(mon, "lunch").swapped, true);
  assert.equal(byId(mon, "dinner").notes, MENUS.dinner[1]);
  assert.equal(byId(mon, "dinner").swapped, undefined);
  const nextMon = computeDay(d("2026-10-12"), {}, new Set(), plan);
  assert.equal(byId(nextMon, "lunch").notes, MENUS.lunch[1]);
});

test("setMealOverride with empty text removes the swap", () => {
  let p = ps.setMealOverride({}, "2026-10-05", "lunch", "X");
  p = ps.setMealOverride(p, "2026-10-05", "lunch", "");
  assert.deepEqual(p.meals, {});
  assert.deepEqual(ps.setMealOverride({}, "bad", "lunch", "X").meals, {});
  assert.deepEqual(ps.setMealOverride({}, "2026-10-05", "nope", "X").meals, {});
});

test("menuOptions lists distinct entries with their weekdays", () => {
  const opts = ps.menuOptions("snack");
  assert.equal(opts.length, 3);
  assert.deepEqual(opts.find((o) => o.text.startsWith("Roasted")).weekdays, [0, 3, 6]);
});

test("off day hides workout, stretch and walks but keeps meds and meals; shows label", () => {
  const plan = ps.addOffRange({}, "2026-10-05", "2026-10-06", "Vacation");
  const items = computeDay(d("2026-10-05"), {}, new Set(), plan);
  assert.ok(!items.some((i) => i.category === "workout" || i.category === "exercise"));
  assert.ok(byId(items, "breakfast") && byId(items, "lunch") && byId(items, "dinner"));
  assert.ok(byId(items, "stable-n-fit-am") && byId(items, "evion-l-5000"));
  assert.match(byId(items, "wake-weigh").notes, /Vacation/);
  // day after the range is normal; the day before too
  assert.ok(byId(computeDay(d("2026-10-07"), {}, new Set(), plan), "walk-lunch"));
  assert.ok(byId(computeDay(d("2026-10-04"), {}, new Set(), plan), "workout-warmup"));
  assert.ok(!byId(computeDay(d("2026-10-06"), {}, new Set(), plan), "walk-lunch"));
});

test("off-day medicine timing is unchanged", () => {
  const plan = ps.addOffRange({}, "2026-10-05", "2026-10-05", "Off");
  const a = computeDay(d("2026-10-05"), {}, new Set(), plan);
  const b = computeDay(d("2026-10-05"), {}, new Set(), NONE);
  for (const i of b.filter((x) => x.category === "medicine")) assert.equal(byId(a, i.id).time, i.time);
});

test("addOffRange / removeOffRange keep order and validity", () => {
  let p = ps.addOffRange({}, "2026-11-01", "2026-11-03", "B");
  p = ps.addOffRange(p, "2026-10-01", "", "A");
  assert.deepEqual(p.off.map((r) => r.label), ["A", "B"]);
  assert.equal(p.off[0].to, "2026-10-01");
  p = ps.removeOffRange(p, 0);
  assert.deepEqual(p.off.map((r) => r.label), ["B"]);
  assert.equal(ps.offDayFor(p, "2026-11-02").label, "B");
  assert.equal(ps.offDayFor(p, "2026-11-04"), null);
});

test("per-weekday workout settings are honoured", () => {
  const plan = ps.setWorkoutDays({}, [1, 3, 5]);
  assert.ok(byId(computeDay(d("2026-10-05"), {}, new Set(), plan), "workout-warmup")); // Mon
  const tue = computeDay(d("2026-10-06"), {}, new Set(), plan);
  assert.ok(!byId(tue, "workout-warmup") && !byId(tue, "stretch") && !byId(tue, "workout-1"));
  assert.ok(byId(tue, "walk-lunch"), "walks are not workout days");
  assert.deepEqual(ps.effectiveWorkoutDays(plan), [1, 3, 5]);
  assert.deepEqual(ps.effectiveWorkoutDays({}), WORKOUT.days);
  const none = ps.setWorkoutDays({}, []);
  assert.ok(!byId(computeDay(d("2026-10-05"), {}, new Set(), none), "workout-warmup"));
  assert.deepEqual(ps.setWorkoutDays(plan, null).workoutDays, null);
});

test("edited default times persist into the schedule; per-day overrides still win", () => {
  let plan = ps.setDefaultTime({}, "breakfast", "09:00");
  const day = computeDay(d("2026-10-06"), {}, new Set(), plan);
  assert.equal(byId(day, "breakfast").time, "09:00");
  assert.equal(byId(day, "stable-n-fit-am").time, "09:05");
  assert.equal(byId(computeDay(d("2026-10-06"), { breakfast: "10:00" }, new Set(), plan), "breakfast").time, "10:00");
  assert.equal(ps.effectiveTimes(plan).breakfast, "09:00");
  assert.equal(ps.effectiveTimes(plan).lunch, DEFAULT_TIMES.lunch);
  plan = ps.setDefaultTime(plan, "breakfast", DEFAULT_TIMES.breakfast);
  assert.deepEqual(plan.times, {});
  assert.deepEqual(ps.setDefaultTime({}, "nope", "09:00").times, {});
  assert.deepEqual(ps.setDefaultTime({}, "wake", "9am").times, {});
});

test("Monday evening gets the moong dal prep for Tuesday's chilla", () => {
  const mon = computeDay(d("2026-10-05"), {}, new Set(), NONE);
  const prep = byId(mon, "prep-moong-dal");
  assert.ok(prep);
  assert.equal(prep.label, "Soak moong dal for tomorrow's chilla");
  assert.equal(prep.category, "prep");
  assert.equal(prep.time, "21:50"); // bedtime 22:30 - 40
  assert.ok(byId(mon, "soak-almonds"));
  // not on other evenings
  assert.ok(!byId(computeDay(d("2026-10-06"), {}, new Set(), NONE), "prep-moong-dal"));
  assert.ok(!byId(computeDay(d("2026-10-07"), {}, new Set(), NONE), "prep-moong-dal"));
});

test("prep follows bedtime and is skipped when tomorrow's meal is swapped", () => {
  const late = computeDay(d("2026-10-05"), { bedtime: "23:30" }, new Set(), NONE);
  assert.equal(byId(late, "prep-moong-dal").time, "22:50");
  const swapped = ps.setMealOverride({}, "2026-10-06", "breakfast", "Eggs");
  assert.ok(!byId(computeDay(d("2026-10-05"), {}, new Set(), swapped), "prep-moong-dal"));
  const other = ps.setMealOverride({}, "2026-10-06", "lunch", "Eggs");
  assert.ok(byId(computeDay(d("2026-10-05"), {}, new Set(), other), "prep-moong-dal"));
});

test("prep works across month/year end and ids stay unique", () => {
  const dec = computeDay(d("2026-12-31"), {}, new Set(), NONE); // Thursday; Fri snack sprouts
  assert.ok(byId(dec, "prep-sprouts-fri"));
  for (let i = 0; i < 7; i++) {
    const items = computeDay(new Date(2026, 9, 4 + i, 12), {}, new Set(), NONE);
    assert.equal(new Set(ids(items)).size, items.length);
  }
});

test("storage: save/load round trip, empty plan removes the key, corrupt data is safe", () => {
  globalThis.localStorage = fakeStorage();
  try {
    assert.deepEqual(ps.loadPlan(), ps.emptyPlan());
    const plan = ps.setWorkoutDays(ps.addOffRange({}, "2026-10-05", "2026-10-05", "Trip"), [2]);
    assert.ok(ps.savePlan(plan));
    assert.ok(localStorage.getItem("elevate-planner:plan"));
    assert.deepEqual(ps.loadPlan(), plan);
    // computeDay defaults to the saved plan
    assert.ok(!byId(computeDay(d("2026-10-05")), "walk-lunch"));
    ps.savePlan(ps.emptyPlan());
    assert.equal(localStorage.getItem("elevate-planner:plan"), null);
    localStorage.setItem("elevate-planner:plan", "{not json");
    assert.deepEqual(ps.loadPlan(), ps.emptyPlan());
    ps.savePlan(plan);
    ps.clearPlan();
    assert.ok(ps.isEmptyPlan(ps.loadPlan()));
  } finally {
    delete globalThis.localStorage;
  }
});

test("meal notes: text only, per date and slot", () => {
  globalThis.localStorage = fakeStorage();
  try {
    assert.equal(ps.getMealNote("2026-10-05", "lunch"), "");
    ps.setMealNote("2026-10-05", "lunch", "  ate half  ");
    assert.equal(ps.getMealNote("2026-10-05", "lunch"), "ate half");
    assert.equal(ps.getMealNote("2026-10-05", "dinner"), "");
    assert.equal(ps.getMealNote("2026-10-06", "lunch"), "");
    ps.setMealNote("2026-10-05", "lunch", "");
    assert.equal(localStorage.getItem(ps.MEALNOTES_KEY), null);
  } finally {
    delete globalThis.localStorage;
  }
});

test("grocery parser handles the menu's quantity styles", () => {
  const f = (t) => parseMeal(t).map((x) => `${x.name}:${x.qty}${x.unit || ""}`);
  assert.deepEqual(f("Besan chilla (40g besan) + 50g vegetables (onion, tomato, spinach) + oil 1 tsp + Curd 100g"),
    ["besan:40g", "vegetables:50g", "oil:1tsp", "curd:100g"]);
  assert.deepEqual(f("Mix veg + Tofu (80g tofu) + 1 small Jowar Bhakri (30g)"), ["vegetables:null", "tofu:80g", "jowar bhakri:30g"]);
  assert.deepEqual(f("Warm water 250ml + lemon 1tsp + soaked almonds (5)"), ["lemon:1tsp", "almonds:5pcs"]);
  assert.deepEqual(f("Stir-fried vegetables + soy chunks 40g raw"), ["vegetables:null", "soya chunks:40g"]);
  assert.deepEqual(f("Moong dal chilla (50g soaked moong dal) + paneer stuffing 40g + oil 1 tsp — soak dal the night before"),
    ["moong dal:50g", "paneer:40g", "oil:1tsp"]);
  assert.deepEqual(f("Little Millet Khichdi (little millet 2 tbsp + masoor dal 2 tbsp + chopped veg 1 katori + ghee 1 tsp)"),
    ["little millet:2tbsp", "masoor dal:2tbsp", "vegetables:1katori", "ghee:1tsp"]);
  assert.deepEqual(f("Dal (40g raw) + vegetable sabzi 100g (no roti)"), ["dal (raw):40g", "vegetable sabzi:100g"]);
  assert.deepEqual(f(""), []);
});

test("formatQty converts to kg / L", () => {
  assert.equal(formatQty(1500, "g"), "1.5 kg");
  assert.equal(formatQty(250, "ml"), "250 ml");
  assert.equal(formatQty(2500, "ml"), "2.5 L");
});

test("weekly grocery totals sum across the rotation", () => {
  const week = weekOf(d("2026-10-08"));
  assert.equal(week.length, 7);
  assert.equal(week[0].getDay(), 1);
  assert.equal(week[6].getDay(), 0);
  const list = buildGrocery(week, NONE);
  const get = (n) => list.items.find((i) => i.name === n);
  assert.equal(get("tofu").qtyText, "160 g"); // Sat lunch 80 + Tue dinner 80
  assert.equal(get("jowar bhakri").qtyText, "150 g");
  assert.equal(get("cucumber").qtyText, "63 slices");
  assert.equal(get("almonds").qtyText, "38 pcs"); // 7 x 5 + 3
  assert.ok(list.other.some((o) => o.names.includes("green tea")));
  // sorted, unique
  const names = list.items.map((i) => i.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.equal(new Set(names).size, names.length);
});

test("grocery reflects meal swaps", () => {
  const week = weekOf(d("2026-10-08"));
  const plan = ps.setMealOverride({}, "2026-10-09", "lunch", "Tofu (500g tofu)"); // Fri lunch
  const list = buildGrocery(week, plan);
  assert.equal(list.items.find((i) => i.name === "tofu").qtyText, "660 g");
  assert.equal(buildGrocery([], NONE).items.length, 0);
});

test("grocery text lists items and ticks", () => {
  const list = buildGrocery(weekOf(d("2026-10-08")), NONE);
  const txt = groceryText(list, "T", new Set(["tofu"]));
  assert.match(txt, /^T\n/);
  assert.match(txt, /\[x\] tofu — 160 g/);
  assert.match(txt, /\[ \] paneer — /);
  assert.match(txt, /Snack \(no quantity listed\):/);
});

test("grocery checked storage persists per week and prunes", () => {
  globalThis.localStorage = fakeStorage();
  return import("../grocery.js").then((g) => {
    try {
      g.saveChecked("2026-10-05", new Set(["tofu", "curd"]));
      assert.deepEqual([...g.loadChecked("2026-10-05")].sort(), ["curd", "tofu"]);
      assert.equal(g.loadChecked("2026-10-12").size, 0);
      for (let i = 1; i <= 8; i++) g.saveChecked(`2026-11-0${i}`, new Set(["x"]));
      assert.equal(g.loadChecked("2026-10-05").size, 0, "oldest weeks pruned");
      g.saveChecked("2026-11-08", new Set());
      assert.equal(g.loadChecked("2026-11-08").size, 0);
    } finally {
      delete globalThis.localStorage;
    }
  });
});
